// Run the actual popup script with an extension-message boundary and a minimal DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const html = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8').replace(
  /^const BUILD = .*;$/m,
  'const BUILD = {version:"1.7.1",hash:"1234abcd",tags:75151,ui:3894,hard:381,communityUrl:"https://novelai.000.moe"};',
);
const connected = { ui: true, tags: true, auto: true, community: { count: 123, time: 1792627200000, hash: 'a1b2c3d4', failed: false } };
const flush = () => new Promise(setImmediate);

// chrome.storage.local over a plain object, with onChanged events like the real API.
function extensionStorage(data = {}) {
  const listeners = [];
  const notify = (changes) => { if (Object.keys(changes).length) for (const fn of listeners) fn(changes, 'local'); };
  return {
    data,
    local: {
      get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
      async set(items) {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
          data[k] = structuredClone(v);
        }
        notify(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const k of [keys].flat().filter((k) => k in data)) {
          changes[k] = { oldValue: data[k] };
          delete data[k];
        }
        notify(changes);
      },
    },
    onChanged: { addListener: (fn) => listeners.push(fn) },
  };
}

async function popup(state = connected, stored = {}) {
  const nodes = new Map();
  const documentEvents = {};
  const timers = [];
  let timerId = 0;
  const messages = [];
  let focused = null;
  for (const [, tag, id, text] of html.matchAll(/<([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/g)) {
    const listeners = {};
    const attrs = {};
    nodes.set(id, {
      hidden: /\bhidden\b/.test(tag), disabled: /\bdisabled\b/.test(tag), checked: false,
      textContent: text, title: '', className: '', dataset: {},
      classList: { add() {}, toggle() {} },
      setAttribute(key, value) { attrs[key] = String(value); },
      getAttribute(key) { return attrs[key] ?? null; },
      addEventListener(type, listener) { listeners[type] = listener; },
      focus() { focused = id; },
      async fire(type) { await listeners[type]?.({ target: this }); },
    });
  }
  const io = { state, failWrite: false, reply: null, storage: extensionStorage(stored) };
  vm.runInNewContext(script, {
    document: {
      getElementById: (id) => nodes.get(id),
      body: { classList: { add() {} } },
      addEventListener: (type, listener) => { documentEvents[type] = listener; },
    },
    chrome: { tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (id, message) => {
        assert.equal(id, 7);
        if (message.type === 'nzh-get') return io.state;
        messages.push(message);
        if (io.failWrite) throw new Error('Disconnected');
        return io.reply ? io.reply : { ok: true };
      },
    }, storage: io.storage },
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => { timers.push({ id: ++timerId, fn }); return timerId; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    URL, console,
  });
  await flush();
  return {
    node: (id) => nodes.get(id), io, messages,
    focus: () => focused,
    key: (key) => documentEvents.keydown?.({ key }),
    async settle() { const t = timers.shift(); assert.ok(t, 'a post-reload status check is scheduled'); await t.fn(); await flush(); },
    timers: () => timers.length,
  };
}

test('without a page, settings show the last saved values and stay editable while refresh is unavailable', async () => {
  const p = await popup(null, { settings: { ui: true, tags: true, auto: false, hours: 6 }, queued: { auto: true } });
  for (const id of ['ui', 'tags', 'auto', 'hours']) assert.equal(p.node(id).disabled, false);
  assert.equal(p.node('refresh').disabled, true);
  assert.equal(p.node('ui').checked, true);
  assert.equal(p.node('auto').checked, true);
  assert.equal(p.node('hours').value, '6');
  assert.equal(p.node('n-tags').textContent, '75,151');
  assert.equal(p.node('n-community').textContent, '—');
  assert.equal(p.node('notice').hidden, true);
  assert.equal(p.node('community-meta').textContent, '');
});

test('without a page, changes wait in extension storage for the next NovelAI page', async () => {
  const p = await popup(null);
  assert.equal(p.node('ui').checked, false);
  assert.equal(p.node('tags').checked, true);
  assert.equal(p.node('hours').value, '24');
  p.node('hours').value = '6';
  await p.node('hours').fire('change');
  p.node('tags').checked = false;
  await p.node('tags').fire('change');
  assert.deepEqual({ ...p.io.storage.data.queued }, { hours: 6, tags: false });
  assert.equal(p.messages.length, 0);
  assert.equal(p.node('tags').checked, false);
  assert.equal(p.node('auto').disabled, true);
  assert.match(p.node('notice').className, /ok/);
  assert.match(p.node('notice').textContent, /刷新/);
});

test('the tag reference switch needs Chinese tags and applies on the page without a reload', async () => {
  const p = await popup({ ...connected, compare: false });
  assert.equal(p.node('compare').checked, false);
  assert.equal(p.node('compare').disabled, false);
  p.io.state = { ...connected, compare: true };
  p.node('compare').checked = true;
  await p.node('compare').fire('change');
  assert.deepEqual(p.messages.map((m) => [m.key, m.value]), [['compare', true]]);
  assert.equal(p.timers(), 0);
  assert.equal(p.node('compare').checked, true);
  assert.equal(p.node('compare').disabled, false);
  assert.equal(p.node('connection').dataset.state, 'connected');
  assert.match(p.node('notice').className, /ok/);
  assert.doesNotMatch(p.node('notice').textContent, /刷新/);
  assert.equal((await popup({ ...connected, tags: false, compare: true })).node('compare').disabled, true);
  // Without a page the change waits like the other settings.
  const offline = await popup(null, { settings: { ui: false, tags: true, compare: true, auto: true, hours: 24 } });
  assert.equal(offline.node('compare').checked, true);
  offline.node('compare').checked = false;
  await offline.node('compare').fire('change');
  assert.deepEqual({ ...offline.io.storage.data.queued }, { compare: false });
});

test('a page whose settings changed since it loaded asks for a refresh', async () => {
  const p = await popup({ ...connected, stale: true });
  assert.equal(p.node('notice').hidden, false);
  assert.match(p.node('notice').textContent, /刷新/);
  assert.equal((await popup()).node('notice').hidden, true);
});

test('arrow keys on the interval save once the choice settles, mouse choices save at once', async () => {
  const p = await popup({ ...connected, hours: 1 });
  await p.node('hours').fire('keydown');
  p.node('hours').value = '6';
  await p.node('hours').fire('change');
  await p.node('hours').fire('keydown');
  p.node('hours').value = '12';
  await p.node('hours').fire('change');
  assert.equal(p.messages.length, 0);
  await p.settle();
  assert.deepEqual(p.messages.map((m) => [m.key, m.value]), [['hours', 12]]);
  const blur = await popup({ ...connected, hours: 1 });
  await blur.node('hours').fire('keydown');
  blur.node('hours').value = '6';
  await blur.node('hours').fire('change');
  await blur.node('hours').fire('blur');
  assert.deepEqual(blur.messages.map((m) => [m.key, m.value]), [['hours', 6]]);
});

test('a confirmed change stays shown while the reloading page is not reachable yet', async () => {
  const p = await popup(connected, { settings: { ui: true, tags: true, auto: true, hours: 24 } });
  p.node('ui').checked = false;
  await p.node('ui').fire('change');
  p.io.state = null;
  await p.settle();
  assert.equal(p.node('ui').checked, false);
});

test('settings opens from home and Escape restores home and keyboard focus', async () => {
  const p = await popup();
  assert.equal(p.node('settings-panel')?.hidden, true);
  await p.node('settings-open').fire('click');
  assert.equal(p.node('main-panel').hidden, true);
  assert.equal(p.node('settings-panel').hidden, false);
  assert.equal(p.focus(), 'settings-close');
  p.key('Escape');
  assert.equal(p.node('main-panel').hidden, false);
  assert.equal(p.node('settings-panel').hidden, true);
  assert.equal(p.focus(), 'settings-open');
});

test('a disabled tag feature keeps cached translation counts and prevents refresh', async () => {
  const p = await popup({ ...connected, tags: false });
  assert.equal(p.node('ui').checked, true);
  assert.equal(p.node('tags').checked, false);
  assert.equal(p.node('refresh').disabled, true);
  assert.equal(p.node('auto').disabled, true);
  assert.equal(p.node('n-community').textContent, '123');
});

test('auto update switch shows the page setting and saves changes through the bridge', async () => {
  const p = await popup({ ...connected, auto: false, hours: 6 });
  assert.equal(p.node('auto').checked, false);
  assert.equal(p.node('auto').disabled, false);
  assert.equal(p.node('hours').value, '6');
  assert.equal(p.node('hours').disabled, true);
  assert.equal(p.node('community-meta').textContent, '');
  p.node('auto').checked = true;
  await p.node('auto').fire('change');
  assert.equal(p.messages[0].key, 'auto');
  assert.equal(p.messages[0].value, true);
});

test('choosing an update interval sends the hours and restores the saved value on failure', async () => {
  const p = await popup({ ...connected, hours: 6 });
  assert.equal(p.node('hours').disabled, false);
  p.node('hours').value = '12';
  await p.node('hours').fire('change');
  assert.equal(p.messages[0].key, 'hours');
  assert.equal(p.messages[0].value, 12);
  const failed = await popup({ ...connected, hours: 6 });
  failed.io.failWrite = true;
  failed.node('hours').value = '168';
  await failed.node('hours').fire('change');
  assert.equal(failed.node('hours').value, '6');
  assert.match(failed.node('notice').className, /err/);
});

test('failed toggle restores the confirmed value and allows another attempt', async () => {
  const p = await popup();
  p.io.failWrite = true;
  p.node('ui').checked = false;
  await p.node('ui').fire('change');
  assert.equal(p.node('ui').checked, true);
  assert.equal(p.node('ui').disabled, false);
  assert.equal(p.node('notice').hidden, false);
  assert.match(p.node('notice').className, /err/);
});

test('refresh stays disabled during reload and shows fresh data after reconnecting', async () => {
  const p = await popup();
  await p.node('refresh').fire('click');
  assert.equal(p.node('refresh').disabled, true);
  assert.equal(p.node('refresh').getAttribute('aria-busy'), 'true');
  assert.equal(p.messages[0].key, 'refresh');
  p.io.state = { ...connected, community: { count: 124, time: 1792630000000, hash: 'new12345', failed: false } };
  await p.settle();
  assert.equal(p.node('n-community').textContent, '124');
  assert.equal(p.node('refresh').disabled, false);
  assert.equal(p.node('refresh').getAttribute('aria-busy'), 'false');
});

test('refresh does not report success when the page returns an unrefreshed cache', async () => {
  const p = await popup();
  await p.node('refresh').fire('click');
  await p.settle();
  assert.equal(p.node('notice').hidden, false);
  assert.match(p.node('notice').className, /err/);
  assert.equal(p.node('refresh').disabled, false);
});

test('losing connection clears cached status from the popup', async () => {
  const p = await popup();
  await p.node('refresh').fire('click');
  p.io.state = null;
  await p.settle();
  assert.equal(p.node('n-community').textContent, '—');
  assert.equal(p.node('refresh').disabled, true);
  assert.equal(p.node('ui').checked, false);
  assert.equal(p.node('ui').disabled, false);
});

test('a failed download with a new attempt time is not displayed as a successful update', async () => {
  const p = await popup();
  await p.node('refresh').fire('click');
  p.io.state = { ...connected, community: { ...connected.community, time: 1792630000000, failed: true } };
  await p.settle();
  assert.match(p.node('notice').className, /err/);
  assert.equal(p.node('n-community').textContent, '123');
});

test('community downloads report failure to the popup bridge while keeping cached translations', async () => {
  let cached = JSON.stringify({ time: 100, entries: [{ tag: 'cat ears', label: '猫耳', aliases: [] }] });
  let offline = true;
  const context = vm.createContext({
    NZH_COMMUNITY_DATA: 'https://example.test/tags.tsv', tagsEnabled: true, dict: null,
    HAN_RE: /\p{Script=Han}/u, crypto: globalThis.crypto, TextEncoder,
    localStorage: {
      getItem: (key) => key === 'nzh-community' ? cached : null,
      setItem: (key, value) => { assert.equal(key, 'nzh-community'); cached = value; },
    },
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: extensionStorage() },
    console: { warn() {} },
    nativeFetch: async () => {
      if (offline) throw new Error('Offline');
      return new Response('dog ears\t犬耳\n');
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../src/community.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8'), context);
  await context.refreshCommunity();
  const failed = await context.state();
  assert.equal(failed.community.failed, true);
  assert.equal(failed.community.count, 1);
  assert.equal(JSON.parse(cached).entries[0].tag, 'cat ears');
  offline = false;
  await context.refreshCommunity();
  assert.equal((await context.state()).community.failed, false);
  assert.equal(JSON.parse(cached).entries[0].tag, 'dog ears');
});

// Load the page-side community script and the bridge over a shared localStorage; report scheduled downloads and reloads.
async function loadPage(store, storage = extensionStorage(), chrome = { runtime: { onMessage: { addListener() {} } }, storage }) {
  const scheduled = [];
  let reloads = 0;
  const visibility = [];
  const events = [];
  const timers = [];
  const document = {
    hidden: false,
    addEventListener: (type, fn) => type === 'visibilitychange' && visibility.push(fn),
    dispatchEvent: (e) => events.push(e.type),
  };
  const context = vm.createContext({
    NZH_COMMUNITY_DATA: 'https://example.test/tags.tsv', tagsEnabled: true, dict: null,
    HAN_RE: /\p{Script=Han}/u, crypto: globalThis.crypto, TextEncoder,
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    window: { addEventListener: (type) => scheduled.push(type) },
    sessionStorage: { getItem: () => null },
    location: { reload() { reloads++; } }, setTimeout: (fn) => timers.push(fn), document, chrome, Event,
  });
  vm.runInContext(fs.readFileSync(new URL('../src/community.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8'), context);
  await flush();
  const hide = async () => { document.hidden = true; for (const fn of visibility) fn(); await flush(); };
  // Runs what the bridge scheduled, such as the reload after a setting change.
  const runTimers = () => timers.splice(0).forEach((fn) => fn());
  return { scheduled, context, reloads: () => reloads, hide, events, runTimers };
}

test('with auto update off the page only downloads after a manual refresh', async () => {
  const store = new Map([['nzh-community-auto', 'off'], ['nzh-community', JSON.stringify({ time: 100, entries: [] })]]);
  assert.deepEqual((await loadPage(store)).scheduled, []);
  (await loadPage(store)).context.set('refresh', true);
  assert.deepEqual((await loadPage(store)).scheduled, ['load']);
  // A manual refresh also works before anything has been downloaded.
  store.delete('nzh-community');
  (await loadPage(store)).context.set('refresh', true);
  assert.deepEqual((await loadPage(store)).scheduled, ['load']);
  store.set('nzh-community', JSON.stringify({ time: 100, entries: [] }));
  (await loadPage(store)).context.set('auto', true);
  assert.equal(store.has('nzh-community-auto'), false);
  assert.deepEqual((await loadPage(store)).scheduled, ['load']);
});

test('the chosen update interval decides when cached translations are stale', async () => {
  const store = new Map([['nzh-community', JSON.stringify({ time: Date.now() - 2 * 3600e3, entries: [] })]]);
  const page = await loadPage(store);
  assert.deepEqual(page.scheduled, []);
  assert.equal((await page.context.state()).hours, 24);
  assert.equal(page.context.set('hours', 1), true);
  assert.equal(store.get('nzh-community-hours'), '1');
  assert.deepEqual((await loadPage(store)).scheduled, ['load']);
  for (const bad of [0, 3, 2.5, 48, '6']) assert.equal(page.context.set('hours', bad), false);
  assert.equal(store.get('nzh-community-hours'), '1');
  store.set('nzh-community-hours', 'junk');
  assert.deepEqual((await loadPage(store)).scheduled, []);
  assert.equal((await (await loadPage(store)).context.state()).hours, 24);
  store.set('nzh-community', JSON.stringify({ time: Date.now() - 2 * 86400e3, entries: [] }));
  assert.deepEqual((await loadPage(store)).scheduled, ['load']);
  assert.equal(page.context.set('hours', 168), true);
  assert.deepEqual((await loadPage(store)).scheduled, []);
});

test('a page applies settings queued while it was closed, reloads once, then records them', async () => {
  const store = new Map();
  const storage = extensionStorage({ queued: { tags: false, hours: 6 } });
  const first = await loadPage(store, storage);
  assert.equal(first.reloads(), 1);
  assert.equal(store.get('nzh-tags'), 'off');
  assert.equal(store.get('nzh-community-hours'), '6');
  assert.equal('queued' in storage.data, false);
  const next = await loadPage(store, storage);
  assert.equal(next.reloads(), 0);
  assert.deepEqual(storage.data.settings, { ui: false, tags: false, compare: false, auto: true, hours: 6 });
  // Queued values the page already uses do not cause a reload.
  storage.data.queued = { tags: false };
  assert.equal((await loadPage(store, storage)).reloads(), 0);
});

test('open NovelAI tabs take a queued change without reloading and report that a refresh is needed', async () => {
  const store = new Map();
  const storage = extensionStorage();
  const a = await loadPage(store, storage);
  const b = await loadPage(store, storage);
  await storage.local.set({ queued: { ui: true } });
  await flush();
  assert.equal(store.get('nzh-ui-lang'), 'zh');
  assert.equal(a.reloads() + b.reloads(), 0);
  assert.equal('queued' in storage.data, false);
  assert.equal((await a.context.state()).stale, true);
  assert.equal(storage.data.settings.ui, true);
  assert.equal((await (await loadPage(store, storage)).context.state()).stale, false);
});

test('the saved copy follows settings the page changes itself and is only rewritten when they differ', async () => {
  const store = new Map();
  const storage = extensionStorage();
  const page = await loadPage(store, storage);
  assert.equal(storage.data.settings.ui, false);
  let writes = 0;
  const set = storage.local.set;
  storage.local.set = async (items) => { writes++; return set(items); };
  // NovelAI's own language menu writes the preference (src/ui.js).
  store.set('nzh-ui-lang', 'zh');
  await page.hide();
  assert.equal(storage.data.settings.ui, true);
  await page.hide();
  assert.equal(writes, 1);
});

test('the tag reference switch is applied by the page script in place, without a reload or a stale page', async () => {
  const store = new Map();
  const page = await loadPage(store);
  assert.equal((await page.context.state()).compare, false);
  assert.equal(page.context.set('compare', true), true);
  assert.equal(store.get('nzh-tag-compare'), 'on');
  assert.deepEqual(page.events, ['nzh-compare']);
  page.runTimers();
  assert.equal(page.reloads(), 0);
  const s = await page.context.state();
  assert.equal(s.compare, true);
  assert.equal(s.stale, false);
  page.context.set('compare', false);
  assert.equal(store.has('nzh-tag-compare'), false);
  // Other settings still reload the page.
  page.context.set('tags', false);
  page.runTimers();
  assert.equal(page.reloads(), 1);
});

test('turning on the Chinese UI also switches the language NovelAI saved for logged-out use', async () => {
  const store = new Map([['noAccountSettings', JSON.stringify({ uiLanguage: 'en', settingsVersion: 17 })]]);
  const page = await loadPage(store);
  assert.equal((await page.context.state()).ui, false);
  page.context.set('ui', true);
  assert.deepEqual(JSON.parse(store.get('noAccountSettings')), { uiLanguage: 'zh', settingsVersion: 17 });
  assert.equal(store.get('nzh-ui-lang'), 'zh');
  assert.equal((await page.context.state()).ui, true);
  page.context.set('ui', false);
  assert.equal(JSON.parse(store.get('noAccountSettings')).uiLanguage, 'en');
  // Turning it off leaves Japanese chosen in NovelAI alone.
  store.set('noAccountSettings', JSON.stringify({ uiLanguage: 'jp' }));
  page.context.set('ui', false);
  assert.equal(JSON.parse(store.get('noAccountSettings')).uiLanguage, 'jp');
  // Logged out, the switch shows the language NovelAI uses, also when chosen in NovelAI's own menu.
  store.set('noAccountSettings', JSON.stringify({ uiLanguage: 'zh' }));
  assert.equal((await page.context.state()).ui, true);
  // Logged in, the account settings decide and the logged-out copy is ignored.
  store.set('session', JSON.stringify({ auth_token: 'x' }));
  assert.equal((await page.context.state()).ui, false);
  // Nothing is created when NovelAI has no logged-out settings yet; the first visit uses the preference.
  const fresh = new Map();
  (await loadPage(fresh)).context.set('ui', true);
  assert.equal(fresh.has('noAccountSettings'), false);
  store.set('noAccountSettings', 'not json');
  assert.equal((await loadPage(store)).context.set('ui', true), true);
  assert.equal(store.get('noAccountSettings'), 'not json');
});

test('a manual refresh clears the previous failure so the popup waits for the new attempt', async () => {
  const store = new Map([['nzh-community', JSON.stringify({ time: 100, entries: [], failed: true })]]);
  (await loadPage(store)).context.set('refresh', true);
  const c = JSON.parse(store.get('nzh-community'));
  assert.equal(c.time, 0);
  assert.equal(c.failed, false);
});

test('the bridge still answers the popup when extension storage is unavailable', async () => {
  let listener = null;
  const page = await loadPage(new Map(), undefined, { runtime: { id: 'x', onMessage: { addListener: (fn) => { listener = fn; } } } });
  assert.equal(typeof listener, 'function');
  assert.equal(page.reloads(), 0);
});
