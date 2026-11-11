import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = html.match(/\/\/ BEGIN STATIC GHL COUNT ENGINE([\s\S]*?)\/\/ END STATIC GHL COUNT ENGINE/)[1];
function locks() {
  const queues = new Map();
  return { request(name, callback) { const run = (queues.get(name) || Promise.resolve()).catch(() => {}).then(callback); queues.set(name, run.catch(() => {})); return run; } };
}
class Cache {
  constructor() { this.rows = new Map(); }
  async get(scope, zip) { return this.rows.get(scope + ':' + zip) || null; }
  async put(row) { this.rows.set(row.key, row); }
}
function fixture(Broadcast = undefined) {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout, navigator: {}, BroadcastChannel: Broadcast, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(code + '\nglobalThis.Engine = GhlZipCountEngine; globalThis.Cache = GhlCountCache;', context);
  return context;
}
const response = (total, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: key => headers[key] ?? null }, json: async () => ({ contacts: [{ id: 'synthetic-contact' }], total }) });
const accountResponse = (total, status = 200, headers = {}) => ({ ...response(total, status, headers), json: async () => ({ contacts: [], meta: { total } }) });
async function settle(engine) {
  const start = Date.now();
  while (engine.active || engine.queue.length || engine.checks.size || engine.background.length || engine.pumping) {
    if (Date.now() - start > 8000) throw Error('Queue did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function engine(options = {}) {
  const { Engine } = fixture(options.Broadcast);
  const { Broadcast, accountFetcher = async () => accountResponse(211155), fetcher = async () => response(1106), validate = true, ...rest } = options;
  const item = new Engine({ locks: locks(), cache: new Cache(), interval: 0, ...rest,
    fetcher: (url, init) => init.method === 'GET' ? accountFetcher(url, init) : fetcher(url, init) });
  await item.connect('synthetic-private-token', 'SyntheticLocation1');
  if (validate) assert.equal(await item.validateAccount(), true);
  return item;
}

test('reads total, keeps the exact postalCode filter, and caches instead of paging', async () => {
  const calls = []; const e = await engine({ fetcher: async (url, options) => { calls.push({ url, options }); return response(1106); } });
  await e.batch(['33701']); await settle(e);
  for (let i = 0; i < 20; i++) assert.equal((await e.batch(['33701'])).counts[0].total, 1106);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { locationId: 'SyntheticLocation1', page: 1, pageLimit: 1, filters: [{ field: 'postalCode', operator: 'eq', value: '33701' }] });
  assert.equal(calls[0].url, 'https://services.leadconnectorhq.com/contacts/search');
  assert.equal(calls[0].options.headers.Version, '2021-07-28');
  e.disconnect();
});
test('zero is a valid cached count; request failure is never zero', async () => {
  const e = await engine({ fetcher: async () => response(0) });
  await e.batch(['00601']); await settle(e);
  assert.equal((await e.batch(['00601'])).counts[0].total, 0);
  const bad = await engine({ fetcher: async () => response(undefined) });
  await bad.batch(['00601']); await settle(bad);
  const result = (await bad.batch(['00601'])).counts[0];
  assert.equal(result.total, null); assert.equal(result.state, 'error');
  e.disconnect(); bad.disconnect();
});
test('cache scope separates locations and credentials; token is not persisted', async () => {
  const cache = new Cache(); const e = await engine({ cache });
  await e.batch(['33701']); await settle(e);
  const original = e.context.scope;
  assert.ok(!JSON.stringify([...cache.rows.values()]).includes('synthetic-private-token'));
  await e.connect('other-private-token', 'SyntheticLocation1'); assert.notEqual(e.context.scope, original);
  assert.equal((await e.batch(['33701'])).counts[0].total, null); await settle(e);
  await e.connect('synthetic-private-token', 'OtherLocation2'); assert.notEqual(e.context.scope, original);
  e.disconnect();
});
test('two tabs sharing cache and Web Locks fetch the same ZIP once', async () => {
  let calls = 0; const sharedLocks = locks(), cache = new Cache();
  const fetcher = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return response(1106); };
  const a = await engine({ locks: sharedLocks, cache, fetcher });
  const b = await engine({ locks: sharedLocks, cache, fetcher });
  await Promise.all([a.batch(['33701']), b.batch(['33701']), a.batch(['33701'])]);
  await Promise.all([settle(a), settle(b)]);
  assert.equal(calls, 1); a.disconnect(); b.disconnect();
});
test('request pacing is coordinated across tabs and separate ZIPs', async () => {
  const times = []; const sharedLocks = locks(); const cache = new Cache();
  const fetcher = async () => { times.push(Date.now()); return response(1); };
  const a = await engine({ locks: sharedLocks, cache, fetcher, interval: 30 });
  const b = await engine({ locks: sharedLocks, cache, fetcher, interval: 30 });
  await Promise.all([a.batch(['10001', '10002']), b.batch(['10003'])]);
  await Promise.all([settle(a), settle(b)]);
  assert.equal(times.length, 3); assert.ok(times[1] - times[0] >= 25); assert.ok(times[2] - times[1] >= 25);
  a.disconnect(); b.disconnect();
});
test('offscreen queued ZIPs do not trigger provider calls', async () => {
  const called = []; const e = await engine({ fetcher: async (_url, options) => { called.push(JSON.parse(options.body).filters[0].value); return response(1); } });
  e.setWanted(['10001']); await e.batch(['10001', '10002']); await settle(e);
  assert.deepEqual(called, ['10001']); e.disconnect();
});
test('authorization failure stops the queue without retrying every ZIP', async () => {
  let calls = 0; const e = await engine({ fetcher: async () => { calls++; return response(null, 403); } });
  const zips = Array.from({ length: 25 }, (_, i) => String(10000 + i));
  await e.batch(zips); await settle(e);
  assert.ok(calls <= 2); assert.equal(e.blocked, 'access_denied');
  const count = (await e.batch(['10000'], true)).counts[0]; assert.equal(count.total, null); assert.equal(count.error, 'access_denied');
  e.disconnect();
});
test('one 429 retry honors Retry-After', async () => {
  const times = []; const e = await engine({ fetcher: async () => { times.push(Date.now()); return times.length === 1 ? response(null, 429, { 'Retry-After': '1' }) : response(1106); } });
  await e.batch(['33701']); await settle(e);
  assert.equal(times.length, 2); assert.ok(times[1] - times[0] >= 990);
  assert.equal((await e.batch(['33701'])).counts[0].total, 1106); e.disconnect();
});
test('manual refresh is cooled down; a validated cached count remains visible during explicit refresh', async () => {
  let calls = 0; const e = await engine({ fetcher: async () => { calls++; return response(1200); } });
  const now = Date.now() / 1000;
  await e.cache.put({ key: e.context.scope + ':33701', scope: e.context.scope, zip: '33701', total: 1106,
    fetched_at: now - 4000, expires_at: Number.MAX_SAFE_INTEGER, cache_generation: e.account.cache_generation });
  const cached = (await e.batch(['33701'])).counts[0]; assert.equal(cached.total, 1106); assert.equal(cached.stale, false);
  assert.equal(calls, 0);
  assert.equal((await e.batch(['33701'], true)).counts[0].total, 1106);
  await settle(e); assert.equal((await e.batch(['33701'], true)).counts[0].total, 1200);
  await settle(e); assert.equal(calls, 1); e.disconnect();
});
test('batch returns before the GHL request resolves so ZIP rendering never waits for counts', async () => {
  let release; const blocker = new Promise(resolve => { release = resolve; });
  const e = await engine({ fetcher: async () => { await blocker; return response(1106); } });
  const result = await Promise.race([e.batch(['33701']), new Promise((_r, reject) => setTimeout(() => reject(Error('blocked on network')), 100))]);
  assert.equal(result.counts[0].total, null); release(); await settle(e); e.disconnect();
});
test('HTML has loading indicators and contains no embedded bearer token or local server requirement', () => {
  assert.match(html, /zl-contact-loading::before/); assert.match(html, /aria-busy/);
  assert.ok(!html.includes('pit-')); assert.ok(!html.includes('counts_server.py'));
  assert.match(html, /type="password"/);
});

const waitFor = async predicate => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 8000) throw Error('Timed out'); await new Promise(r => setTimeout(r, 2)); }
};

test('every connection checks meta.total with the supplied GET contract, without a body or pagination', async () => {
  const calls = []; const e = await engine({ accountFetcher: async (url, options) => { calls.push({ url, options }); return accountResponse(211155); } });
  assert.equal(e.account.total, 211155); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://services.leadconnectorhq.com/contacts/?locationId=SyntheticLocation1&limit=1');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.headers.Version, 'v3');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-private-token');
  await e.connect('synthetic-private-token', 'SyntheticLocation1'); await e.validateAccount();
  assert.equal(calls.length, 2); e.disconnect();
});

test('cached ZIP counts stay hidden while the account-total check is pending; unchanged total reuses them without hourly expiry', async () => {
  const cache = new Cache(); let zipCalls = 0;
  const a = await engine({ cache, fetcher: async () => { zipCalls++; return response(1106); } });
  await a.batch(['33701']); await settle(a); const generation = a.account.cache_generation; a.disconnect();
  const row = [...cache.rows.values()].find(r => r.zip === '33701'); row.fetched_at -= 86400 * 30; row.expires_at = 1;
  let release; const blocker = new Promise(r => { release = r; });
  const b = await engine({ cache, validate: false, fetcher: async () => { zipCalls++; return response(1234); }, accountFetcher: async () => { await blocker; return accountResponse(211155); } });
  const checking = b.validateAccount();
  assert.equal((await b.batch(['33701'])).counts[0].total, null);
  assert.equal((await b.batch(['33701'])).counts[0].state, 'loading');
  assert.equal(zipCalls, 1); release(); assert.equal(await checking, true);
  assert.equal(b.account.cache_generation, generation);
  assert.equal((await b.batch(['33701'])).counts[0].total, 1106);
  await settle(b); assert.equal(zipCalls, 1); b.disconnect();
});

test('changed total hides all old counts and refreshes all Used ZIPs, including offscreen and more than the queue cap', async () => {
  const cache = new Cache(); const a = await engine({ cache });
  const zips = Array.from({ length: 320 }, (_, i) => String(10000 + i));
  const oldGeneration = a.account.cache_generation;
  for (const zip of zips) await cache.put({ key: a.context.scope + ':' + zip, scope: a.context.scope, zip, total: 9,
    fetched_at: Date.now() / 1000, expires_at: Number.MAX_SAFE_INTEGER, cache_generation: oldGeneration });
  a.disconnect();
  const called = []; let release; const blocker = new Promise(r => { release = r; });
  const b = await engine({ cache, validate: false, accountFetcher: async () => accountResponse(211156), fetcher: async (_url, init) => {
    called.push(JSON.parse(init.body).filters[0].value); await blocker; return response(10);
  } });
  b.setWanted(['10319']); b.setUsed(zips); await b.validateAccount();
  assert.notEqual(b.account.cache_generation, oldGeneration);
  assert.equal((await b.batch(['10000'])).counts[0].total, null);
  await waitFor(() => called.length >= 2); assert.equal(called[0], '10319');
  release(); await settle(b);
  assert.equal(called.length, 320); assert.equal(new Set(called).size, 320);
  for (const zip of zips) assert.equal((await cache.get(b.context.scope, zip)).cache_generation, b.account.cache_generation);
  b.disconnect();
});

test('zero account total is valid; invalid or failed account checks never expose cached ZIP counts or overwrite the baseline', async () => {
  for (const invalid of [undefined, -1, 1.5, '211155', null, Number.MAX_SAFE_INTEGER + 1]) {
    const cache = new Cache(); const a = await engine({ cache }); await a.batch(['33701']); await settle(a);
    const baseline = a.account; a.disconnect();
    const b = await engine({ cache, validate: false, accountFetcher: async () => accountResponse(invalid) });
    assert.equal(await b.validateAccount(), false);
    const item = (await b.batch(['33701'])).counts[0]; assert.equal(item.total, null); assert.equal(item.state, 'error');
    assert.equal((await cache.get(b.context.scope, '@account')).cache_generation, baseline.cache_generation); b.disconnect();
  }
  const zero = await engine({ accountFetcher: async () => accountResponse(0) }); assert.equal(zero.account.total, 0); zero.disconnect();
});

test('failed account check preserves cache and explicit retry can validate it without redundant ZIP requests', async () => {
  const cache = new Cache(); const a = await engine({ cache }); await a.batch(['33701']); await settle(a); a.disconnect();
  let accountCalls = 0, zipCalls = 0;
  const b = await engine({ cache, validate: false, accountFetcher: async () => ++accountCalls === 1 ? accountResponse(null, 403) : accountResponse(211155), fetcher: async () => { zipCalls++; return response(999); } });
  assert.equal(await b.validateAccount(), false); assert.equal((await b.batch(['33701'])).counts[0].total, null);
  assert.equal(await b.validateAccount(), true); assert.equal((await b.batch(['33701'])).counts[0].total, 1106);
  await settle(b); assert.equal(zipCalls, 0); assert.equal(accountCalls, 2); b.disconnect();
});

test('new Used ZIPs fetch immediately under an unchanged account total while existing ones stay cached', async () => {
  let calls = 0; const e = await engine({ fetcher: async () => { calls++; return response(3); } });
  e.setUsed(['00601']); await settle(e); assert.equal(calls, 1);
  e.setUsed(['00601', '10001']); await settle(e); assert.equal(calls, 2);
  assert.equal((await e.batch(['10001'])).counts[0].total, 3); e.disconnect();
});

test('two tabs each validate total but share one refreshed count per ZIP; old-generation responses cannot overwrite the new cache', async () => {
  const cache = new Cache(), sharedLocks = locks(); let total = 100, calls = 0, release;
  const blocker = new Promise(r => { release = r; });
  const a = await engine({ cache, locks: sharedLocks, accountFetcher: async () => accountResponse(total), fetcher: async () => { calls++; await blocker; return response(1); } });
  a.setUsed(['33701']); await waitFor(() => calls === 1); const old = a.account.cache_generation;
  total = 101;
  const b = await engine({ cache, locks: sharedLocks, accountFetcher: async () => accountResponse(total), fetcher: async () => { calls++; return response(2); } });
  b.setUsed(['33701']); release(); await Promise.all([settle(a), settle(b)]);
  const row = await cache.get(b.context.scope, '33701');
  assert.notEqual(row.cache_generation, old); assert.equal(row.cache_generation, b.account.cache_generation); assert.equal(row.total, 2);
  assert.equal(calls, 2); a.disconnect(); b.disconnect();
});

test('legacy hourly entries are not trusted without a matching generation; count caches and account metadata contain no credentials', async () => {
  const e = await engine(); const scope = e.context.scope;
  await e.cache.put({ key: scope + ':33701', scope, zip: '33701', total: 999, fetched_at: Date.now() / 1000, expires_at: Number.MAX_SAFE_INTEGER });
  assert.equal((await e.batch(['33701'])).counts[0].total, null); await settle(e);
  assert.equal((await e.batch(['33701'])).counts[0].total, 1106);
  assert.ok(!JSON.stringify([...e.cache.rows.values()]).includes('synthetic-private-token')); e.disconnect();
});

test('account requests share rate pacing with ZIP requests and honor a bounded 429 retry', async () => {
  const times = []; let calls = 0;
  const e = await engine({ validate: false, interval: 20, accountFetcher: async () => {
    times.push(Date.now()); calls++; return calls === 1 ? accountResponse(null, 429, { 'Retry-After': '1' }) : accountResponse(5);
  }, fetcher: async () => { times.push(Date.now()); return response(1); } });
  assert.equal(await e.validateAccount(), true); await e.batch(['33701']); await settle(e);
  assert.equal(times.length, 3); assert.ok(times[1] - times[0] >= 990); assert.ok(times[2] - times[1] >= 15); e.disconnect();
});

test('disconnect during an account request cannot validate a new connection or persist the wrong account baseline', async () => {
  const cache = new Cache(); let release; const blocker = new Promise(r => { release = r; });
  const e = await engine({ cache, validate: false, accountFetcher: async () => { await blocker; return accountResponse(20); } });
  const pending = e.validateAccount(); await new Promise(r => setTimeout(r, 5));
  e.disconnect(); release(); assert.equal(await pending, false); assert.equal(cache.rows.size, 0);
});

test('a changed baseline broadcasts invalidation to an already open tab and both tabs coalesce the new ZIP generation', async () => {
  class Channel {
    static channels = new Set();
    constructor(name) { this.name = name; Channel.channels.add(this); }
    postMessage(data) { for (const target of Channel.channels) if (target !== this && target.name === this.name) queueMicrotask(() => Channel.channels.has(target) && target.onmessage?.({ data })); }
    close() { Channel.channels.delete(this); }
  }
  const cache = new Cache(), sharedLocks = locks(); let total = 100, calls = 0;
  const options = { cache, locks: sharedLocks, Broadcast: Channel, accountFetcher: async () => accountResponse(total), fetcher: async () => { calls++; return response(total); } };
  const a = await engine(options); a.setUsed(['33701']); await settle(a);
  assert.equal((await a.batch(['33701'])).counts[0].total, 100); const old = a.account.cache_generation;
  total = 101; const b = await engine(options); b.setUsed(['33701']);
  await waitFor(() => a.account.cache_generation !== old); await Promise.all([settle(a), settle(b)]);
  assert.equal(calls, 2); assert.equal((await a.batch(['33701'])).counts[0].total, 101);
  assert.equal(a.account.cache_generation, b.account.cache_generation); a.disconnect(); b.disconnect();
});

test('returning to an earlier account total creates a new generation instead of reviving old ZIP counts', async () => {
  const cache = new Cache(); let total = 100;
  const e = await engine({ cache, accountFetcher: async () => accountResponse(total) });
  await e.batch(['33701']); await settle(e); const original = e.account.cache_generation;
  total = 101; await e.validateAccount(); assert.notEqual(e.account.cache_generation, original);
  total = 100; await e.validateAccount(); assert.notEqual(e.account.cache_generation, original);
  assert.equal((await e.batch(['33701'])).counts[0].total, null); await settle(e); e.disconnect();
});

test('GHL search removes leading zeroes while cache and results keep five-digit ZIPs', async () => {
  const values = []; const cache = new Cache();
  const e = await engine({ cache, fetcher: async (_url, options) => {
    values.push(JSON.parse(options.body).filters[0].value); return response(7);
  } });
  const zips = ['00601', '01234', '00001', '00000', '33701', '10101'];
  await e.batch(zips); await settle(e);
  assert.deepEqual(values.slice().sort(), ['601', '1234', '1', '0', '33701', '10101'].sort());
  for (const zip of zips) {
    assert.equal((await e.batch([zip])).counts[0].zip, zip);
    assert.equal((await cache.get(e.context.scope, zip)).zip, zip);
  }
  e.disconnect();
});
test('unpadded search uses a new cache scope so old padded-search counts are not reused', async () => {
  const e = await engine();
  const old = Buffer.from(await webcrypto.subtle.digest('SHA-256',
    new TextEncoder().encode('SyntheticLocation1|synthetic-private-token|postalCode:eq:v1'))).toString('hex');
  assert.notEqual(e.context.scope, old); e.disconnect();
});
