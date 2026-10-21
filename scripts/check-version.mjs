// 发布前检查：dist 里的脚本相对基准提交有改动时，版本号必须更高，否则脚本管理器不会推送更新
// 用法: node scripts/check-version.mjs <基准提交或分支>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'dist/novelai-zh-tags.user.js';
const base = process.argv[2];

if (!base || /^0+$/.test(base)) {
  console.log('没有可比较的基准提交，跳过');
  process.exit(0);
}

let before;
try {
  before = execFileSync('git', ['show', `${base}:${FILE}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
} catch {
  console.log(`基准 ${base} 里没有 ${FILE}，跳过`);
  process.exit(0);
}
const after = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const version = (s) => (s.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || '0';
const withoutVersion = (s) => s.replace(/^\/\/ @version.*$/m, '');
const compare = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

if (withoutVersion(before) === withoutVersion(after)) {
  console.log(`脚本内容与 ${base} 相同`);
} else if (compare(version(after), version(before)) <= 0) {
  console.log(`::error::脚本相对 ${base} 有改动，但版本号 ${version(after)} 没有高于 ${version(before)}。改 package.json 的 version 后重新构建。`);
  process.exit(1);
} else {
  console.log(`版本 ${version(before)} → ${version(after)}`);
}
