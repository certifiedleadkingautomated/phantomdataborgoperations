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
function fixture() {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout, navigator: {}, BroadcastChannel: undefined, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(code + '\nglobalThis.Engine = GhlZipCountEngine; globalThis.Cache = GhlCountCache;', context);
  return context;
}
const response = (total, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: key => headers[key] ?? null }, json: async () => ({ contacts: [{ id: 'synthetic-contact' }], total }) });
async function settle(engine) {
  const start = Date.now();
  while (engine.active || engine.queue.length || engine.checks.size) {
    if (Date.now() - start > 8000) throw Error('Queue did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function engine(options = {}) {
  const { Engine } = fixture();
  const item = new Engine({ locks: locks(), cache: new Cache(), interval: 0, fetcher: async () => response(1106), ...options });
  await item.connect('synthetic-private-token', 'SyntheticLocation1');
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
test('manual refresh is cooled down, stale values remain visible during an async refresh', async () => {
  let calls = 0; const e = await engine({ fetcher: async () => { calls++; return response(1200); } });
  const now = Date.now() / 1000;
  await e.cache.put({ key: e.context.scope + ':33701', scope: e.context.scope, zip: '33701', total: 1106, fetched_at: now - 4000, expires_at: now - 400 });
  const stale = (await e.batch(['33701'])).counts[0]; assert.equal(stale.total, 1106); assert.equal(stale.stale, true);
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
