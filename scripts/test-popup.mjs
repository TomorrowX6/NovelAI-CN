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
const connected = { ui: true, tags: true, community: { count: 123, time: 1792627200000, hash: 'a1b2c3d4', failed: false } };
const flush = () => new Promise(setImmediate);

async function popup(state = connected) {
  const nodes = new Map();
  const documentEvents = {};
  const timers = [];
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
  const io = { state, failWrite: false, reply: null };
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
    } },
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, URL, console,
  });
  await flush();
  return {
    node: (id) => nodes.get(id), io, messages,
    focus: () => focused,
    key: (key) => documentEvents.keydown?.({ key }),
    async settle() { const fn = timers.shift(); assert.ok(fn, 'a post-reload status check is scheduled'); await fn(); await flush(); },
  };
}

test('unavailable page disables actions but keeps bundled dictionary counts visible', async () => {
  const p = await popup(null);
  for (const id of ['ui', 'tags', 'refresh']) assert.equal(p.node(id).disabled, true);
  assert.equal(p.node('n-tags').textContent, '75,151');
  assert.equal(p.node('n-community').textContent, '—');
  assert.equal(p.node('open-novelai')?.hidden, false);
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
  assert.equal(p.node('n-community').textContent, '123');
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
    chrome: { runtime: { onMessage: { addListener() {} } } },
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
