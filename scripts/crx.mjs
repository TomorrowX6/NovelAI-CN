// 把 dist/novelai-zh-tags.user.js 打包成 Chrome 扩展（Manifest V3），先 npm run build
// 用法: node scripts/crx.mjs
// 输出到 build/：
//   extension/                  解压的扩展，可在 chrome://extensions 「加载已解压的扩展程序」，manifest 带公钥，扩展 ID 固定
//   novelai-zh-tags-版本.zip    上架 Chrome 应用商店用的压缩包（不含公钥）
//   novelai-zh-tags-版本.crx    用私钥签名的 CRX3 安装包
// 私钥默认在 .keys/novelai-zh-tags.pem（不进 git），可用环境变量 CRX_KEY 指定。没有私钥时会生成一个：
// 扩展 ID 由私钥决定，换私钥就是另一个扩展，请备份好。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const EXT_DIR = path.join(BUILD_DIR, 'extension');
const KEY_FILE = process.env.CRX_KEY ? path.resolve(process.env.CRX_KEY) : path.join(ROOT, '.keys', 'novelai-zh-tags.pem');
const SCRIPT_NAME = 'novelai-zh-tags.js';
const ICON_SIZES = [16, 32, 48, 128];
// 扩展和商店里显示的名称、简介（简介即商店摘要，最多 132 个字符）。用户脚本的 @name 不跟着改：
// 脚本管理器按名称识别脚本，改名会让已安装的用户更新时装出第二份
const EXT_NAME = 'NovelAI中文化';
const EXT_DESCRIPTION = '用中文畅玩 NovelAI：输入中文就能找到对应的英文标签，英文标签也附上中文释义，界面和教程都能切换成中文。（非官方扩展）';

// ---- CRC32 ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---- 图标：深色圆角方块上一个「中」字，按 4×4 子像素算覆盖率做抗锯齿 ----
function roundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// 坐标按 128×128 设计
function iconColor(x, y) {
  const inBox = roundedRect(x, y, 28, 40, 100, 88, 8) && !roundedRect(x, y, 40, 52, 88, 76, 2);
  const inBar = roundedRect(x, y, 58, 14, 70, 114, 3);
  if (inBox || inBar) return [245, 243, 194, 255];
  if (roundedRect(x, y, 4, 4, 124, 124, 26)) {
    const t = y / 128;
    return [Math.round(36 - 12 * t), Math.round(38 - 12 * t), Math.round(78 - 26 * t), 255];
  }
  return [0, 0, 0, 0];
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// 商店建议 128 图标的图案占 96×96、四周留透明边；小图标铺满，在工具栏里更清楚
function iconPng(size) {
  const S = 4;
  const pad = size === 128 ? 16 : 0;
  const scale = 128 / (size - 2 * pad);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = iconColor((px + (sx + 0.5) / S - pad) * scale, (py + (sy + 0.5) / S - pad) * scale);
          for (let i = 0; i < 3; i++) sum[i] += c[i] * c[3];
          sum[3] += c[3];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = sum[3] ? Math.round(sum[i] / sum[3]) : 0;
      raw[o + 3] = Math.round(sum[3] / (S * S));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ZIP：固定时间戳，同样的输入得到同样的文件 ----
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 文件名是 UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    local.copy(central, 8, 6, 26); // 标志、压缩方式、时间、CRC、大小与本地头相同
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- CRX3：https://source.chromium.org/chromium/chromium/src/+/main:components/crx_file/crx3.proto ----
function varint(n) {
  const out = [];
  for (; n > 0x7f; n = Math.floor(n / 128)) out.push((n & 0x7f) | 0x80);
  out.push(n);
  return Buffer.from(out);
}
const pbBytes = (field, data) => Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);

// 扩展 ID：公钥 SHA-256 的前 16 字节，每个十六进制数字 0-f 换成 a-p
const crxId = (spki) => crypto.createHash('sha256').update(spki).digest().subarray(0, 16);
const extensionId = (spki) => [...crxId(spki).toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

function crx3(zipBuf, privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const signedHeaderData = pbBytes(1, crxId(spki)); // SignedData { crx_id = 1 }
  const lenLE = Buffer.alloc(4);
  lenLE.writeUInt32LE(signedHeaderData.length);
  const signature = crypto.sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00'), lenLE, signedHeaderData, zipBuf]), privateKey);
  // CrxFileHeader { sha256_with_rsa = 2 { public_key = 1, signature = 2 }, signed_header_data = 10000 }
  const header = Buffer.concat([pbBytes(2, Buffer.concat([pbBytes(1, spki), pbBytes(2, signature)])), pbBytes(10000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'ascii');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zipBuf]);
}

function loadOrCreateKey() {
  if (fs.existsSync(KEY_FILE)) return crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`已生成新的私钥 ${path.relative(ROOT, KEY_FILE)}。扩展 ID 由它决定，请备份，不要提交到 git。`);
  return privateKey;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const userScript = fs.readFileSync(path.join(ROOT, 'dist', 'novelai-zh-tags.user.js'), 'utf8');
  if ((userScript.match(/^\/\/ @version\s+(\S+)/m) || [])[1] !== pkg.version) {
    throw new Error('dist 里的脚本版本和 package.json 不一致，先运行 npm run build');
  }
  // 用户脚本头对扩展没用，许可说明之类的注释保留
  const script = userScript.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n+/, '');

  const manifest = {
    manifest_version: 3,
    name: EXT_NAME,
    version: pkg.version,
    description: EXT_DESCRIPTION,
    homepage_url: 'https://github.com/TomorrowX6/NovelAI-Tag',
    icons: Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/${s}.png`])),
    // 与用户脚本的 @run-at document-start、@inject-into page、@noframes 对应：
    // 要在 NovelAI 的脚本运行前接管 fetch 和 Turbopack 的模块注册，所以注入页面自身的环境（Chrome 111+）
    content_scripts: [
      { matches: ['https://novelai.net/*'], js: [SCRIPT_NAME], run_at: 'document_start', world: 'MAIN', all_frames: false },
    ],
  };
  const files = [
    [SCRIPT_NAME, Buffer.from(script)],
    ...ICON_SIZES.map((s) => [`icons/${s}.png`, iconPng(s)]),
  ];
  const json = (m) => Buffer.from(JSON.stringify(m, null, 2) + '\n');

  const key = loadOrCreateKey();
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });

  // 解压目录的 manifest 带公钥，「加载已解压的扩展程序」时 ID 与 crx 相同；商店不接受带公钥的 manifest，压缩包里不放
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  for (const [file, data] of [['manifest.json', json({ ...manifest, key: spki.toString('base64') })], ...files]) {
    fs.mkdirSync(path.dirname(path.join(EXT_DIR, file)), { recursive: true });
    fs.writeFileSync(path.join(EXT_DIR, file), data);
  }
  const zipBuf = zip([['manifest.json', json(manifest)], ...files]);
  const base = path.join(BUILD_DIR, `novelai-zh-tags-${pkg.version}`);
  fs.writeFileSync(`${base}.zip`, zipBuf);
  fs.writeFileSync(`${base}.crx`, crx3(zipBuf, key));

  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
  console.log(`扩展 ${pkg.version}，ID ${extensionId(spki)}`);
  for (const p of [EXT_DIR, `${base}.zip`, `${base}.crx`]) console.log(`  ${rel(p)}`);
}

main();
