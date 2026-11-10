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
  assert.deepEqual(zips(sort(items, 'zip-asc')), ['00601','00602','10001','33701','90210']);
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
  sort(items,'contacts-desc',counts); sort(items,'zip-asc',counts);
  assert.equal(JSON.stringify(items),before); assert.equal(JSON.stringify([...counts]),saved);
  assert.deepEqual(zips(sort(items,'contacts-asc',new Map())), ['00601','00602','10001','33701','90210']);
});

const groupApi = vm.runInNewContext(code + '\n({ sumZipContacts, sortUsedZipGroups })');
test('group totals sum unique ZIPs and distinguish partial, zero and unavailable totals', () => {
  const api=groupApi;
  const complete=api.sumZipContacts([{zip:'00601'},{zip:'90210'},{zip:'90210'}],counts);
  assert.equal(complete.total,12);assert.equal(complete.size,2);assert.equal(complete.known,2);assert.equal(complete.complete,true);
  const partial=api.sumZipContacts([{zip:'00601'},{zip:'00602'}],counts);
  assert.equal(partial.total,0);assert.equal(partial.known,1);assert.equal(partial.complete,false);
  const missing=api.sumZipContacts([{zip:'00602'}],counts);
  assert.equal(missing.total,null);assert.equal(missing.complete,false);
});
test('states and cities sort by summed available contact totals in either direction', () => {
  const groups=[
    {state:'A',city:'First',zips:[{zip:'00601'},{zip:'90210'}]},
    {state:'B',city:'Second',zips:[{zip:'33701'},{zip:'10001'}]},
    {state:'C',city:'Unknown',zips:[{zip:'00602'}]},
  ];
  const names=result=>Array.from(result,g=>g.state);
  assert.deepEqual(names(groupApi.sortUsedZipGroups(groups,'contacts-desc',counts)),['B','A','C']);
  assert.deepEqual(names(groupApi.sortUsedZipGroups(groups,'contacts-asc',counts)),['A','B','C']);
  assert.deepEqual(names(groupApi.sortUsedZipGroups(groups,'zip-asc',counts)),['A','B','C']);
});
test('equal totals use state/city labels as stable ties; unknown geography remains available', () => {
  const groups=[{state:'New York',city:'Z',zips:[{zip:'10001'}]},{state:'',city:'',zips:[{zip:'90210'}]},{state:'New York',city:'A',zips:[{zip:'90210'}]}];
  assert.deepEqual(Array.from(groupApi.sortUsedZipGroups(groups,'contacts-desc',counts),g=>g.city),['A','Z','']);
});
test('group sums are recalculated as cached counts arrive, without mutating grouping data', () => {
  const groups=[{state:'A',zips:[{zip:'00602'}]},{state:'B',zips:[{zip:'90210'}]}];
  const dynamic=new Map(counts);const before=JSON.stringify(groups);
  assert.equal(groupApi.sortUsedZipGroups(groups,'contacts-desc',dynamic)[0].state,'B');
  dynamic.set('00602',{total:999});
  assert.equal(groupApi.sortUsedZipGroups(groups,'contacts-desc',dynamic)[0].state,'A');
  assert.equal(JSON.stringify(groups),before);
});
test('unsafe group sums remain unavailable instead of reporting an inaccurate total', () => {
  const result=groupApi.sumZipContacts([{zip:'00601'},{zip:'90210'}],new Map([['00601',{total:Number.MAX_SAFE_INTEGER}],['90210',{total:1}]]));
  assert.equal(result.total,null);assert.equal(result.overflow,true);assert.equal(result.complete,false);
});

