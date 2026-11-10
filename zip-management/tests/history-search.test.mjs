import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helper = html.match(/\/\/ BEGIN HISTORY ZIP SEARCH([\s\S]*?)\/\/ END HISTORY ZIP SEARCH/)[1];
const context = vm.createContext({});
const search = vm.runInContext(helper + '\nsearchHistoryRows', context);
const ids = result => Array.from(result.entries, entry => entry.row.id);
const rows = [
  { id: 'request-1', source: 'contacts', status: 'confirmed', comment: 'Order 42', zips: [{ zip: '00601' }, { zip: '33701' }] },
  { id: 'pending', source: 'contacts', status: 'pending', comment: 'Not confirmed', zips: [{ zip: '33701' }] },
  { id: 'removed', source: 'contacts', status: 'confirmed', comment: 'Order 99', zips: [{ zip: '00601', deleted_event_id: 'deletion-1' }] },
  { id: 'ghl', source: 'ghl', status: 'confirmed', comment: 'Manual GHL list', zips: [{ zip: '00601' }] },
  { id: 'other', source: 'contacts', status: 'confirmed', comment: '00601 is only in this comment', zips: [{ zip: '00602' }] },
];
test('finds every matching history occurrence while preserving order comments and original row indexes', () => {
  const result = search(rows, '00601');
  assert.deepEqual(ids(result), ['request-1', 'removed', 'ghl']);
  assert.deepEqual(Array.from(result.entries, entry => entry.index), [0, 2, 3]);
  assert.equal(result.entries[0].row.comment, 'Order 42');
  assert.equal(result.entries[1].row.comment, 'Order 99');
  assert.equal(result.entries[0].row.zips.length, 2); // retain full entry context
});
test('deleted, pending and manual GHL occurrences remain discoverable with their original status', () => {
  assert.deepEqual(ids(search(rows, '33701')), ['request-1', 'pending']);
  const result = search(rows, '00601');
  assert.equal(result.entries[1].row.zips[0].deleted_event_id, 'deletion-1');
  assert.equal(result.entries[2].row.source, 'ghl');
});
test('matches complete normalized ZIPs, preserves leading zeroes and never searches comments', () => {
  assert.deepEqual(ids(search(rows, ' 601 ')), ['request-1', 'removed', 'ghl']);
  assert.equal(search(rows, '601').zip, '00601');
  assert.deepEqual(ids(search(rows, '3370')), []);
});
test('invalid input leaves history visible and reports an error instead of silently truncating ZIP+4 or lists', () => {
  for (const value of ['00601-1234', '00601,33701', 'ZIP00601', '123456', '<script>']) {
    const result = search(rows, value);
    assert.ok(result.error);
    assert.equal(result.zip, null);
    assert.deepEqual(ids(result), rows.map(row => row.id));
  }
});
test('clearing search restores all rows; a valid missing ZIP returns no entries', () => {
  assert.deepEqual(ids(search(rows, '  ')), rows.map(row => row.id));
  assert.deepEqual(ids(search(rows, '90210')), []);
  assert.equal(search(rows, '90210').error, '');
  assert.deepEqual(ids(search([], '00601')), []);
});
test('search is read-only and works with older string ZIP snapshots too', () => {
  const before = JSON.stringify(rows);
  for (let i = 0; i < 20; i++) search(rows, i % 2 ? '00601' : '33701');
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(ids(search([{ id: 'legacy', zips: ['00601'] }], '00601')), ['legacy']);
});
test('all inline app scripts still compile', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
    if (match[1].trim()) new vm.Script(match[1]);
});
