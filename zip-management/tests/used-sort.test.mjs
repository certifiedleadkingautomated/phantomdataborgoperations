import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = html.match(/\/\/ BEGIN USED ZIP SORT([\s\S]*?)\/\/ END USED ZIP SORT/)[1];
const sort = vm.runInNewContext(code + '\nsortUsedZipItems');
const zips = result => Array.from(result, item => item.zip);
const items = ['90210','00601','33701','10001','00602'].map(zip => ({ zip }));
const counts = new Map([
  ['90210', { total: 12 }], ['00601', { total: 0 }],
  ['33701', { total: 1106 }], ['10001', { total: 12 }],
]);
test('ZIP order is numeric-equivalent for five-digit codes, including leading zeroes', () => {
  assert.deepEqual(zips(sort(items)), ['00601','00602','10001','33701','90210']);
  assert.deepEqual(zips(sort(items, 'zip-desc')), ['90210','33701','10001','00602','00601']);
});
test('contact sorting includes verified zeroes, orders numeric totals and uses ZIP ties', () => {
  assert.deepEqual(zips(sort(items, 'contacts-desc', counts)), ['33701','10001','90210','00601','00602']);
  assert.deepEqual(zips(sort(items, 'contacts-asc', counts)), ['00601','10001','90210','33701','00602']);
});
test('unknown/invalid totals stay last in either direction and are never mistaken for zero', () => {
  const unknown = new Map([['00601',{total:0}],['00602',{total:null}],['10001',{total:'5'}],['33701',{total:-1}],['90210',{total:NaN}]]);
  for (const mode of ['contacts-asc','contacts-desc'])
    assert.deepEqual(zips(sort(items,mode,unknown)), ['00601','00602','10001','33701','90210']);
});
test('cached values remain sortable during loading or refresh failures', () => {
  const cached = new Map([['90210',{total:200,state:'loading'}],['00601',{total:50,state:'error'}]]);
  assert.deepEqual(zips(sort(items,'contacts-desc',cached)), ['90210','00601','00602','10001','33701']);
});
test('sorting never mutates the underlying ZIP data or cached counts', () => {
  const before = JSON.stringify(items), saved = JSON.stringify([...counts]);
  sort(items,'contacts-desc',counts); sort(items,'zip-desc',counts);
  assert.equal(JSON.stringify(items),before); assert.equal(JSON.stringify([...counts]),saved);
  assert.deepEqual(zips(sort(items,'contacts-asc',new Map())), ['00601','00602','10001','33701','90210']);
});
