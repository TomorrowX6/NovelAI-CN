import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = (name) => fs.readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
const raw = 'cat ears\t100\t猫耳\t兽耳\tnekomimi\t0\nlong hair\t90\t长发\t\t\t0\n';
const flush = () => new Promise(setImmediate);
const entry = (label) => ({ tag: 'cat ears', label, aliases: [] });

function dictionary() {
  const ctx = vm.createContext({ setTimeout, MessageChannel });
  vm.runInContext(source('core') + '\nthis.make = createZhDict; this.makeAsync = typeof createZhDictAsync === "function" ? createZhDictAsync : null;', ctx);
  return ctx;
}

function page({ cached = { time: 1, entries: [entry('旧译名')] }, fetch = async () => ({ ok: true, status: 200, text: async () => '' }), sharedStore, locks } = {}) {
  const store = sharedStore || new Map([['nzh-community', JSON.stringify(cached)]]);
  const listeners = new Map();
  const on = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  const dispatch = (event) => { for (const fn of listeners.get(event.type) || []) fn(event); };
  let now = 100;
  class ClockDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({
    Date: ClockDate, Event, setTimeout, clearTimeout, AbortController, console: { warn() {} },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    window: { addEventListener: on }, document: { addEventListener: on, dispatchEvent: dispatch },
    nativeFetch: fetch, navigator: { locks },
  });
  vm.runInContext(source('core') + `\nconst tagsEnabled = true; const NZH_COMMUNITY_DATA = 'https://example.test/tags.tsv'; let dict = createZhDict(${JSON.stringify(raw)});\n` + source('community') + '\namendDict(dict); this.refresh = refreshCommunity; this.lookup = (tag) => dict.lookup(tag);', ctx);
  return { ctx, store, dispatch, clock: (value) => { now = value; }, cache: () => JSON.parse(store.get('nzh-community')) };
}

function runtime() {
  const ctx = vm.createContext({
    setTimeout, MessageChannel, Event, URL, Response, console: { info() {}, warn() {} },
    localStorage: { getItem: () => null },
    document: { getElementsByClassName: () => [], addEventListener() {}, dispatchEvent() {}, createElement: () => ({ dataset: {}, style: {} }) },
    window: { fetch() {}, addEventListener() {}, requestIdleCallback: (fn) => fn() },
    getSelection: () => ({ rangeCount: 0 }),
    MutationObserver: class { observe() {} },
  });
  vm.runInContext(source('core') + `\nconst ZH_TAG_DATA = ${JSON.stringify(raw)}; const ZH_T2S_DATA = '';\n` + source('main') + '\nlet communityEntries = []; function amendDict(d) { d.replaceCommunity(communityEntries); } this.preload = preloadDict; this.sync = getDict; this.current = () => dict; this.annotate = annotatePanel; this.suggest = (query) => suggestZh(query, true, "https://example.test/suggest", {});', ctx);
  return ctx;
}

test('annotation waits for cooperative initialization instead of building on the mutation callback', async () => {
  const ctx = runtime();
  const item = { children: [], appendChild(node) { this.children.push(node); } };
  const span = { textContent: 'cat ears', parentElement: { parentElement: item } };
  ctx.annotate({ querySelectorAll: () => [span], contains: () => true });
  assert.equal(ctx.current(), null);
  await ctx.preload();
  assert.equal(ctx.current().lookup('cat ears'), '猫耳');
});

test('the first Chinese suggestion awaits cooperative initialization', async () => {
  const ctx = runtime();
  const response = ctx.suggest('猫耳');
  assert.equal(ctx.current(), null);
  const result = await (await response).json();
  assert.equal(result[0].en_tag, 'cat ears');
});

test('preloads share one promise and never overwrite an already initialized dictionary', async () => {
  const ctx = runtime();
  const first = ctx.preload();
  assert.equal(ctx.preload(), first);
  const existing = ctx.sync();
  existing.replaceCommunity([entry('更新过的译名')]);
  await first;
  assert.equal(ctx.current(), existing);
  assert.equal(ctx.current().lookup('cat ears'), '更新过的译名');
});

test('replacing community snapshots restores base labels, removes aliases and community-only tags', () => {
  const d = dictionary().make(raw);
  d.replaceCommunity([{ tag: 'cat ears', label: '猫耳新版', aliases: ['喵星耳'] }, { tag: 'new character', label: '新角色', aliases: [], count: 60 }]);
  const revision = d.revision;
  assert.equal(d.lookup('nekomimi'), '猫耳新版');
  assert.equal(d.lookup('new character'), '新角色');
  d.replaceCommunity([{ tag: 'cat ears', label: '', aliases: ['另一检索词'] }]);
  assert.equal(d.lookup('cat ears'), '猫耳');
  assert.equal(d.lookup('new character'), null);
  assert.equal(d.search('喵星耳', 15).length, 0);
  assert.equal(d.search('另一检索词', 15)[0].tag, 'cat ears');
  assert.ok(d.revision > revision);
  d.replaceCommunity([]);
  assert.equal(d.search('另一检索词', 15).length, 0);
  assert.equal(d.lookup('nekomimi'), '猫耳');
  assert.equal(d.size, 2);
});

test('approved non-Danbooru community tags need no image count and appear in comparison', () => {
  const row = 'location\t场景\t场景/地点';
  const p = page({ cached: { time: 1, entries: [] } });
  p.ctx.row = row;
  vm.runInContext('applyCommunity(parseCommunityTsv(row));', p.ctx);
  assert.equal(p.ctx.lookup('location'), '场景');
  const result = vm.runInContext('dict.search("场景", 15)', p.ctx);
  assert.equal(result[0].tag, 'location');
  assert.equal(result[0].count, 0, 'do not invent a Danbooru image count');

  // Render the exact prompt fragment from the screenshot through the real view.
  p.ctx.document.createElement = () => ({ children: [], dataset: {}, append(...nodes) { this.children.push(...nodes); } });
  p.ctx.getDict = () => vm.runInContext('dict', p.ctx);
  p.ctx.MutationObserver = class { observe() {} };
  p.ctx.requestAnimationFrame = () => {};
  vm.runInContext(source('compare') + '\nthis.render = renderComparePanel;', p.ctx);
  const panel = { replaceChildren(...items) { this.items = items; } };
  p.ctx.render(panel, { children: [{ textContent: 'best quality, location, tropical' }] });
  assert.equal(panel.items[1].children[0].textContent, '场景');
  vm.runInContext('applyCommunity({entries: []});', p.ctx);
  assert.equal(p.ctx.lookup('location'), null, 'removing the community entry removes its translation');
});

test('count-free community additions still reject prompt separators and weight syntax', () => {
  const d = dictionary().make(raw);
  for (const tag of ['a, b', 'a|b', '{a}', '[a]', 'a::b', 'source#hug', '<tag>', 'a\\b', 'a\tb', 'a'.repeat(101)]) {
    assert.equal(d.amend(tag, '非法新标签'), false, tag);
    assert.equal(d.lookup(tag), null, tag);
  }
  assert.equal(d.amend('aliases only', '', ['只有检索词']), false);
  assert.equal(d.size, 2);
});

test('cooperative dictionary construction yields before completion and matches synchronous results', async () => {
  const ctx = dictionary();
  let yields = 0;
  let done = false;
  const large = Array.from({ length: 3000 }, (_, i) => `tag ${i}\t${i + 1}\t词条${i}\t\t\t0\n`).join('');
  const pending = ctx.makeAsync(large, '', async () => { assert.equal(done, false); yields++; await flush(); });
  await flush();
  assert.ok(yields > 0);
  const d = await pending;
  done = true;
  const sync = ctx.make(large);
  assert.equal(d.size, sync.size);
  assert.deepEqual(JSON.parse(JSON.stringify(d.search('词条', 15))), JSON.parse(JSON.stringify(sync.search('词条', 15))));
});

test('comparison renders a new dictionary revision without changing the prompt', () => {
  const element = () => ({ children: [], dataset: {}, append(...nodes) { this.children.push(...nodes); } });
  const ctx = vm.createContext({ localStorage: { getItem: () => null }, document: { createElement: element }, window: {} });
  vm.runInContext(source('core') + `\nconst tagsEnabled = false; const dict = createZhDict(${JSON.stringify(raw)}); const getDict = () => dict;\n` + source('compare') + '\nthis.render = renderComparePanel; this.dict = dict;', ctx);
  const panel = { replaceChildren(...items) { this.items = items; } };
  const editor = { children: [{ textContent: 'cat ears' }] };
  ctx.render(panel, editor);
  ctx.dict.amend('cat ears', '新译名');
  ctx.render(panel, editor);
  assert.equal(panel.items[0].children[0].textContent, '新译名');
});

test('a successful empty community snapshot removes the previous overlay and notifies views', async () => {
  const p = page();
  let changes = 0;
  // Listen through the same document event mechanism used by comparison views.
  vm.runInContext('document.addEventListener("nzh-dictionary", () => this.onDictionary());', p.ctx);
  p.ctx.onDictionary = () => { changes++; };
  await p.ctx.refresh();
  assert.equal(p.ctx.lookup('cat ears'), '猫耳');
  assert.equal(p.cache().entries.length, 0);
  assert.equal(changes, 1);
});

test('overlapping manual and automatic downloads share one in-flight request', async () => {
  let calls = 0;
  let resolve;
  const p = page({ fetch: () => { calls++; return new Promise((r) => { resolve = r; }); } });
  const first = p.ctx.refresh();
  const second = p.ctx.refresh();
  assert.equal(calls, 1);
  resolve({ ok: true, status: 200, text: async () => 'cat ears\t新译名\n' });
  await Promise.all([first, second]);
  assert.equal(p.ctx.lookup('cat ears'), '新译名');
});

test('a failed download preserves a different tab\'s newer successful data and freshness', async () => {
  let reject;
  const p = page({ fetch: () => new Promise((_, r) => { reject = r; }) });
  const pending = p.ctx.refresh();
  p.clock(300);
  p.store.set('nzh-community', JSON.stringify({ time: 250, requestTime: 200, entries: [entry('其他页的新译名')], failed: false }));
  reject(new Error('offline'));
  await pending;
  assert.equal(p.cache().entries[0].label, '其他页的新译名');
  assert.equal(p.cache().time, 250);
  assert.equal(p.cache().failed, false);
  assert.equal(p.ctx.lookup('cat ears'), '其他页的新译名');
});

test('a slower older download cannot overwrite a newer tab snapshot', async () => {
  let resolve;
  const p = page({ fetch: () => new Promise((r) => { resolve = r; }) });
  const pending = p.ctx.refresh();
  p.clock(300);
  p.store.set('nzh-community', JSON.stringify({ time: 250, requestTime: 200, entries: [entry('更新的译名')], failed: false }));
  resolve({ ok: true, status: 200, text: async () => 'cat ears\t过时的译名\n' });
  await pending;
  assert.equal(p.cache().entries[0].label, '更新的译名');
  assert.equal(p.ctx.lookup('cat ears'), '更新的译名');
});

test('a newer snapshot from an older extension without request metadata is preserved', async () => {
  let resolve;
  const p = page({ fetch: () => new Promise((r) => { resolve = r; }) });
  const pending = p.ctx.refresh();
  p.store.set('nzh-community', JSON.stringify({ time: 250, entries: [entry('旧版页面的新快照')], failed: false }));
  resolve({ ok: true, status: 200, text: async () => 'cat ears\t过期响应\n' });
  await pending;
  assert.equal(p.cache().entries[0].label, '旧版页面的新快照');
});

test('a hung download aborts so a later manual refresh can retry', async () => {
  const p = page({ fetch: (_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  let timeout;
  p.ctx.setTimeout = (fn) => { timeout = fn; return 1; };
  p.ctx.clearTimeout = () => {};
  const pending = p.ctx.refresh();
  assert.equal(typeof timeout, 'function');
  timeout();
  await pending;
  assert.equal(p.cache().failed, true);
  p.ctx.nativeFetch = async () => ({ ok: true, status: 200, text: async () => 'cat ears\t重试成功\n' });
  await p.ctx.refresh();
  assert.equal(p.cache().failed, false);
  assert.equal(p.ctx.lookup('cat ears'), '重试成功');
});

test('a storage update applies another tab\'s snapshot to the open dictionary', () => {
  const p = page();
  const value = JSON.stringify({ time: 300, entries: [entry('同步的新译名')] });
  p.store.set('nzh-community', value);
  p.dispatch({ type: 'storage', key: 'nzh-community', newValue: value });
  assert.equal(p.ctx.lookup('cat ears'), '同步的新译名');
});

test('same-clock tabs reserve distinct request ordering and preserve the newer response', async () => {
  const store = new Map([['nzh-community', JSON.stringify({ time: 1, entries: [entry('旧缓存')] })]]);
  let tail = Promise.resolve();
  const locks = { request: (_, fn) => { const result = tail.then(fn); tail = result.catch(() => {}); return result; } };
  let first;
  let second;
  const a = page({ sharedStore: store, locks, fetch: () => new Promise((r) => { first = r; }) });
  const b = page({ sharedStore: store, locks, fetch: () => new Promise((r) => { second = r; }) });
  const aPending = a.ctx.refresh();
  const bPending = b.ctx.refresh();
  await flush();
  second({ ok: true, status: 200, text: async () => 'cat ears\t较新响应\n' });
  await bPending;
  first({ ok: true, status: 200, text: async () => 'cat ears\t较旧响应\n' });
  await aPending;
  assert.equal(a.cache().entries[0].label, '较新响应');
  assert.equal(a.ctx.lookup('cat ears'), '较新响应');
});
