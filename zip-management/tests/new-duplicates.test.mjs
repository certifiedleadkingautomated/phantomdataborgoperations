import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function checkerFixture(input) {
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false});return elements.get(id);};
  $('zl-check').value=input;
  const context=vm.createContext({$,model:{busy:false,data:{used:[]}},Set,
    parse:text=>({zips:[...new Set(text.split(',').filter(Boolean).map(z=>z.padStart(5,'0')))],invalid:[]}),
    usedSet:()=>new Set(),pendingSet:()=>new Set(),newSet:()=>new Set(['00601','10001']),feedback:()=>{},
    openAdd:()=>{},validateAdd:()=>{},
  });
  const checker=html.match(/        function checker\(\) \{([\s\S]*?)\n        function render\(\)/)[1];
  const click=html.match(/        function addCheckedToNew\(\) \{([\s\S]*?)\n        \$\("zl-add-checked-new"\)\.addEventListener/)[1];
  vm.runInContext('function checker(){'+checker+'\nfunction addCheckedToNew(){'+click+'\nchecker();',context);
  return {$,context};
}
test('checker passes the full unused list for review without silently filtering New ZIPs',()=>{
  const f=checkerFixture('601,90210');
  assert.equal(f.$('zl-fresh').textContent,'00601, 90210');
  assert.equal(f.$('zl-check-new').textContent,'1 already in New ZIPs.');
  vm.runInContext('addCheckedToNew()',f.context);
  assert.equal(f.$('zl-add-zips').value,'00601,90210');
});
test('an entirely already-New list still opens the same validation form',()=>{
  const f=checkerFixture('601,10001');
  assert.equal(f.$('zl-add-checked-new').hidden,false);
  assert.equal(f.$('zl-add-checked-new').disabled,false);
  vm.runInContext('addCheckedToNew()',f.context);
  assert.equal(f.$('zl-add-zips').value,'00601,10001');
});
function storeFixture() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(html.match(/const SCHEMA = `([\s\S]*?)`;/)[1]);
  sqlite.exec("INSERT INTO subaccounts VALUES('a','A',0),('b','B',0)");
  const db={run:(sql,args=[])=>sqlite.prepare(sql).run(...args)};
  let seq=0;
  const context=vm.createContext({query:(_db,sql,args=[])=>sqlite.prepare(sql).all(...args),
    assert:(value,message)=>assert.ok(value,message),active:()=>[],pendingCodes:()=>[],
    checkZips:zips=>assert.ok(zips.length&&zips.every(z=>/^\d{5}$/.test(z))),id:()=>String(++seq),
    recordDate:()=> '2026-11-11',comment:v=>v??'',now:()=> '2026-11-11T00:00:00Z',
  });
  const branch=html.match(/\} else if \(action === "add_new" \|\| action === "bulk_add_new"\) \{([\s\S]*?)\} else if \(action === "request_batch"\)/)[1];
  vm.runInContext('function intake(db,account,action,payload){'+branch+'}',context);
  return {sqlite,add:(rows,account='a')=>{
    sqlite.exec('BEGIN');try{context.intake(db,{id:account},'bulk_add_new',{rows:rows.map(zips=>({zips}))});sqlite.exec('COMMIT');}
    catch(e){sqlite.exec('ROLLBACK');throw e;}
  }};
}
test('SQLite refuses persisted New ZIPs and repeated import rows atomically',()=>{
  const f=storeFixture();try{
    f.add([['00601']]);
    assert.throws(()=>f.add([['00601','90210']]),/already Used, pending, or in New ZIPs/);
    assert.throws(()=>f.add([['90211'],['90211']]),/already Used, pending, or in New ZIPs/);
    assert.deepEqual(f.sqlite.prepare('SELECT zip FROM new_zip_items').all().map(r=>r.zip),['00601']);
    f.add([['00601']],'b');
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM new_zip_items').get().n,2);
  }finally{f.sqlite.close();}
});
