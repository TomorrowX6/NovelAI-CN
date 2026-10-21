// ---- 界面汉化 ----
// NovelAI 的界面文案是一个英文对象（日文在它上面合并一份覆盖），由 Localization atom 按 uiLanguage 算出，
// 语言选单列出 languageNames 里的语言。NovelAI 用 Turbopack 打包，模块的导出表通过 ctx.s(bindings) 注册：
// 这里在 document-start 接管 globalThis.TURBOPACK，在注册导出时给语言表加上中文，
// 并让 Localization atom 在 uiLanguage 为 zh 时把中文合并到算好的文案上。没翻译的条目保持英文。

const UI_LANG = 'zh';
const UI_LANG_NAME = '中文';
const UI_LANG_KEY = 'nzh-ui-lang';
const UI_HOOKED = Symbol.for('novelai-zh-tags.ui');
const UI_FLAG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><path fill="#de2910" d="M0 0h30v20H0z"/><path fill="#ffde00" d="M5 2L5.67 4.07L7.85 4.07L6.09 5.35L6.76 7.43L5 6.15L3.24 7.43L3.91 5.35L2.15 4.07L4.33 4.07ZM9.14 2.51L9.62 1.97L9.25 1.34L9.91 1.63L10.39 1.08L10.33 1.8L11 2.09L10.29 2.25L10.22 2.97L9.85 2.35ZM11.01 4.14L11.66 3.82L11.56 3.1L12.07 3.62L12.72 3.3L12.38 3.95L12.88 4.47L12.17 4.34L11.83 4.99L11.73 4.27ZM11.04 6.73L11.76 6.7L11.96 6L12.21 6.68L12.94 6.66L12.37 7.1L12.62 7.79L12.01 7.38L11.44 7.83L11.64 7.13ZM9.22 8.38L9.9 8.63L10.35 8.06L10.32 8.79L11 9.05L10.3 9.24L10.26 9.96L9.87 9.36L9.16 9.55L9.62 8.98Z"/></svg>',
  );

// 中文合并到英文（或 NovelAI 自己算好的）文案上，只替换类型相同的条目，NovelAI 删掉的条目不会加回去
function mergeLocale(base, zh) {
  if (Array.isArray(base)) {
    // 文件名模板说明这类 [记号, 说明] 列表按记号对应，NovelAI 增删条目时不会错位
    const byKey = new Map(Array.isArray(zh) ? zh.map((r) => [r[0], r]) : []);
    return base.map((r) => (Array.isArray(r) && byKey.has(r[0]) ? byKey.get(r[0]) : r));
  }
  const out = { ...base };
  for (const k of Object.keys(zh)) {
    const b = base[k];
    const z = zh[k];
    if (typeof b === 'string') {
      if (typeof z === 'string') out[k] = z;
    } else if (b && typeof b === 'object' && z && typeof z === 'object') {
      out[k] = mergeLocale(b, z);
    }
  }
  return out;
}

// 选了中文时账号设置里存的是 en（官方客户端只认 en/jp），本机另记一个标记，见下面的 uiSettingsFetch
function uiPrefZh() {
  try {
    return localStorage.getItem(UI_LANG_KEY) === UI_LANG;
  } catch {
    return false;
  }
}

function setUiPrefZh(on) {
  try {
    if (on) localStorage.setItem(UI_LANG_KEY, UI_LANG);
    else localStorage.removeItem(UI_LANG_KEY);
  } catch {}
}

function patchLocalizationAtom(atom, getSession, getLast) {
  if (!atom || typeof atom.read !== 'function' || atom[UI_HOOKED]) return;
  atom[UI_HOOKED] = true;
  const read = atom.read;
  atom.read = function (get, ...rest) {
    const loc = read.call(this, get, ...rest);
    if (get(getSession())?.settings?.uiLanguage !== UI_LANG) return loc;
    const zh = mergeLocale(loc, ZH_UI_DATA);
    // 不在 React 里的代码从 lastLocalization 取文案
    const last = getLast && getLast();
    if (last) last.value = zh;
    return zh;
  };
}

// bindings: [名字, getter(, setter) | 0, 值, ...]。patch 返回替换后的导出值，按原值缓存
function patchExports(bindings) {
  const at = new Map();
  for (let i = 0; i < bindings.length; ) {
    at.set(bindings[i], i + 1);
    i += bindings[i + 1] === 0 || typeof bindings[i + 2] === 'function' ? 3 : 2;
  }
  const value = (name) => {
    const j = at.get(name);
    return bindings[j] === 0 ? bindings[j + 1] : bindings[j]();
  };
  const patch = (name, fn) => {
    const j = at.get(name);
    if (bindings[j] === 0) {
      bindings[j + 1] = fn(bindings[j + 1]);
      return;
    }
    const getter = bindings[j];
    let orig;
    let patched;
    bindings[j] = () => {
      const v = getter();
      if (v !== orig) {
        orig = v;
        patched = fn(v);
      }
      return patched;
    };
  };

  if (at.has('languageNames') && at.has('languageIcons')) {
    patch('languageNames', (names) => {
      if (names && !names[UI_LANG]) names[UI_LANG] = UI_LANG_NAME;
      return names;
    });
    patch('languageIcons', (icons) => {
      if (icons && !icons[UI_LANG]) icons[UI_LANG] = UI_FLAG;
      return icons;
    });
    if (at.has('Language')) {
      patch('Language', (langs) => {
        if (langs && !langs[UI_LANG]) langs[UI_LANG] = UI_LANG;
        return langs;
      });
    }
  }
  if (at.has('Localization') && at.has('Session')) {
    patch('Localization', (atom) => {
      patchLocalizationAtom(atom, () => value('Session'), at.has('lastLocalization') ? () => value('lastLocalization') : null);
      return atom;
    });
  }
  // 没登录时的默认语言：本机选过中文就用中文
  if (at.has('getBrowserLanguage')) {
    patch('getBrowserLanguage', (fn) =>
      typeof fn === 'function' ? (...args) => (uiPrefZh() ? UI_LANG : fn(...args)) : fn,
    );
  }
}

function wrapFactory(factory) {
  return function (ctx) {
    const s = ctx && ctx.s;
    if (typeof s === 'function') {
      Object.defineProperty(ctx, 's', {
        configurable: true,
        writable: true,
        value(bindings, ...rest) {
          if (Array.isArray(bindings)) {
            try {
              patchExports(bindings);
            } catch (e) {
              console.warn('[novelai-zh-tags]', e);
            }
          }
          return s.call(this, bindings, ...rest);
        },
      });
    }
    return factory.apply(this, arguments);
  };
}

// 分块格式: [script, 模块 id..., 工厂函数, 模块 id..., 工厂函数, ...]
function wrapChunk(chunk) {
  if (Array.isArray(chunk)) {
    for (let i = 1; i < chunk.length; i++) if (typeof chunk[i] === 'function') chunk[i] = wrapFactory(chunk[i]);
  }
  return chunk;
}

function hookPush(target) {
  if (!target || typeof target.push !== 'function' || target[UI_HOOKED]) return;
  const push = target.push;
  Object.defineProperty(target, 'push', {
    configurable: true,
    writable: true,
    value(...chunks) {
      return push.apply(this, chunks.map(wrapChunk));
    },
  });
  Object.defineProperty(target, UI_HOOKED, { value: true });
}

// 分块先 push 进一个数组，运行时加载后把 globalThis.TURBOPACK 换成 {push}，两次都要接管。
// 运行时要求接管前的 TURBOPACK 仍是数组
if (!globalThis[UI_HOOKED]) {
  globalThis[UI_HOOKED] = true;
  let turbopack = globalThis.TURBOPACK;
  if (Array.isArray(turbopack)) turbopack.forEach(wrapChunk);
  else if (turbopack === undefined) turbopack = [];
  hookPush(turbopack);
  Object.defineProperty(globalThis, 'TURBOPACK', {
    configurable: true,
    get: () => turbopack,
    set(v) {
      turbopack = v;
      hookPush(v);
    },
  });
}

// 账号设置的 uiLanguage 只认 en/jp：保存设置时把 zh 换成 en、本机记下选的是中文，
// 读取账号数据时再换回 zh。这样账号设置里不会出现官方客户端不认识的值，没装脚本的设备照常显示英文
const CLIENT_SETTINGS_PATH = '/user/clientsettings';
const USER_DATA_PATH = '/user/data';

function uiSettingsFetch(url, init, nativeRequest) {
  let path;
  try {
    path = new URL(url, location.href).pathname;
  } catch {
    return null;
  }
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (path.endsWith(CLIENT_SETTINGS_PATH) && method === 'PUT' && typeof init.body === 'string') {
    let settings;
    try {
      settings = JSON.parse(init.body);
    } catch {
      return null;
    }
    if (!settings || typeof settings !== 'object' || !settings.uiLanguage) return null;
    if (settings.uiLanguage !== UI_LANG) {
      setUiPrefZh(false);
      return null;
    }
    setUiPrefZh(true);
    settings.uiLanguage = 'en';
    return nativeFetch.call(window, url, { ...init, body: JSON.stringify(settings) });
  }
  if (path.endsWith(USER_DATA_PATH) && method === 'GET' && uiPrefZh()) {
    return nativeRequest().then(async (res) => {
      if (!res.ok) return res;
      try {
        const data = await res.clone().json();
        const raw = data && data.settings;
        const settings = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!settings || typeof settings !== 'object' || (settings.uiLanguage || 'en') !== 'en') return res;
        settings.uiLanguage = UI_LANG;
        data.settings = typeof raw === 'string' ? JSON.stringify(settings) : settings;
        return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch {
        return res;
      }
    });
  }
  return null;
}
