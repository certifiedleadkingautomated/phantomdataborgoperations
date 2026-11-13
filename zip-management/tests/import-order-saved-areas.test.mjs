import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(html.match(/const SCHEMA = `([\s\S]*?)`;/)[1]);
 sqlite.exec("INSERT INTO subaccounts VALUES('a','A',0),('b','B',0)");
 const db={run:(sql,args=[])=>sqlite.prepare(sql).run(...args)};
 const query=(_db,sql,args=[])=>sqlite.prepare(sql).all(...args);let seq=0;
 const ctx=vm.createContext({assert:(ok,msg)=>assert.ok(ok,msg),query,first:(...args)=>query(...args)[0],
  checkZips:z=>assert.ok(z.length&&z.every(code=>/^\d{5}$/.test(code))),comment:v=>v||'',recordDate:d=>d,
  active:()=>[],pendingCodes:()=>[],consumeNew:()=>{},id:()=>String(++seq),now:()=> '2026-11-13T10:00:00Z',
 });
 const start=html.indexOf('            if (action === "add" || action === "bulk_add") {');
 const end=html.indexOf('            } else if (action === "request_batch")',start);
 const saves=html.match(/\} else if \(action === "save_map_area"\) \{([\s\S]*?)\} else if \(action === "reset"\)/)[1];
 vm.runInContext('function intake(db,account,action,payload){'+html.slice(start,end)+'}}\nfunction area(db,account,action,payload){if(action==="save_map_area"){'+saves+'}}',ctx);
 const change=(action,payload,account='a')=>{sqlite.exec('BEGIN');try{(action.includes('map_area')?ctx.area:ctx.intake)(db,{id:account},action,payload);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 return {sqlite,change};
}
test('oldest history row owns ZIP provenance while displayed rows retain newest-first paste order',()=>{
 const f=fixture();try{
  f.change('bulk_add',{rows:[{zips:['00601'],date:'2026-11-13',source:'contacts',comment:'Newest'},{zips:['00601'],date:'2026-11-13',source:'contacts',comment:'Oldest'}]});
  const rows=f.sqlite.prepare('SELECT h.comment,z.already_used FROM history_rows h JOIN history_zips z ON z.row_id=h.id ORDER BY h.created_at DESC,h.rowid DESC').all();
  assert.deepEqual(rows.map(r=>[r.comment,r.already_used]),[['Newest',1],['Oldest',0]]);
 }finally{f.sqlite.close();}
});
test('New ZIP imports also retain newest-first display order',()=>{
 const f=fixture();try{
  f.change('bulk_add_new',{rows:[{zips:['00601'],date:'2026-11-13',comment:'Newest'},{zips:['10001'],date:'2026-11-13',comment:'Oldest'}]});
  assert.deepEqual(f.sqlite.prepare('SELECT comment FROM new_zip_rows ORDER BY created_at DESC,rowid DESC').all().map(r=>r.comment),['Newest','Oldest']);
 }finally{f.sqlite.close();}
});
test('saved map areas persist exact boundary/count per subaccount and delete without a history trace',()=>{
 const f=fixture();const area={id:'00000000-0000-4000-8000-000000000001',name:'My area',vertices:[{lat:27,lng:-83},{lat:28,lng:-83},{lat:28,lng:-82}],radius:null,available_count:12};
 try{
  f.change('save_map_area',area);f.change('save_map_area',area);
  const saved=f.sqlite.prepare('SELECT * FROM map_areas').all();assert.equal(saved.length,1);assert.deepEqual(JSON.parse(saved[0].vertices),area.vertices);assert.equal(saved[0].available_count,12);
  f.change('delete_map_area',{id:area.id},'b');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM map_areas').get().n,1);
  assert.throws(()=>f.change('save_map_area',{...area,vertices:[]}),/boundary/);
  f.change('delete_map_area',{id:area.id});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM map_areas').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM deletion_events').get().n,0);
 }finally{f.sqlite.close();}
});
