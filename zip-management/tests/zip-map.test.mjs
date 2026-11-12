import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(html.match(/\/\/ BEGIN ZIP MAP CORE([\s\S]*?)\/\/ END ZIP MAP CORE/)[1]+'\nglobalThis.core=ZipMapCore;',context);
const core=context.core;
const rows=[
 {zip:'00601',lat:18.18,lng:-66.75,city:'Adjuntas',state_name:'Puerto Rico'},
 {zip:'33701',lat:27.77,lng:-82.64,city:'St Petersburg',state_name:'Florida'},
 {zip:'33702',lat:27.84,lng:-82.64,city:'St Petersburg',state_name:'Florida'},
 {zip:'33703',lat:27.82,lng:-82.61,city:'St Petersburg',state_name:'Florida'},
 {zip:'33704',lat:27.79,lng:-82.62,city:'St Petersburg',state_name:'Florida'},
];
const data={used:[{zip:'00601'}],incoming:[{zips:['33701','33701']}],pending_zips:['33702']};
const polygon=[{lat:27.7,lng:-82.7},{lat:27.9,lng:-82.7},{lat:27.9,lng:-82.5},{lat:27.7,lng:-82.5}];
test('ZIP lookup preserves leading zeroes and accepts zero coordinates without inventing missing ones',()=>{
 assert.equal(core.zip('601'),'00601');assert.equal(core.zip('00601'),'00601');assert.equal(core.zip('00601-1234'),null);
 const lookup=core.reference([...rows,{zip:'00000',lat:0,lng:0},{zip:'99999',lat:null,lng:null},{zip:'99998',lat:91,lng:0}]);
 assert.equal(lookup.size,6);assert.equal(lookup.get('00000').lat,0);assert.equal(lookup.has('99999'),false);
});
test('Used takes priority, Home overrides color identity without duplicating or consuming a status',()=>{
 const lookup=core.reference(rows),result=core.project({...data,incoming:[{zips:['00601','33701']}]},lookup,'601');
 assert.equal(result.pins.length,2);assert.equal(result.pins.find(p=>p.zip==='00601').home,true);
 assert.equal(result.pins.find(p=>p.zip==='00601').type,'used');assert.deepEqual(Array.from(result.shown.used),['00601']);
 assert.deepEqual(Array.from(result.shown.new),['33701']);
 const homeOnly=core.project(data,lookup,'33704');assert.equal(homeOnly.pins.length,3);assert.equal(homeOnly.pins.find(p=>p.home).type,'home');
 assert.equal(homeOnly.blocked.has('33704'),false);
});
test('missing-coordinate ZIP lists remain explicit, including Home, and are never plotted at 0,0',()=>{
 const result=core.project({used:[{zip:'99999'}],incoming:[{zips:['99998']}]},core.reference(rows),'99997');
 assert.equal(result.pins.length,0);assert.deepEqual(Array.from(result.missing.used),['99999']);
 assert.deepEqual(Array.from(result.missing.new),['99998']);assert.equal(result.homeMissing,true);
});
test('polygon selects all additional ZIP centroids and excludes Used, New and pending requests',()=>{
 const lookup=core.reference(rows),projection=core.project(data,lookup,'33704');
 const selected=core.additional(lookup,polygon,projection.blocked);
 assert.deepEqual(Array.from(selected,p=>p.zip),['33703','33704']);
 assert.equal(data.incoming[0].zips.length,2);assert.equal(data.used.length,1);
});
test('polygon boundary is included; concave areas reject points only inside the bounding rectangle',()=>{
 const p=core.polygon([{lat:0,lng:0},{lat:0,lng:2},{lat:1,lng:1},{lat:2,lng:2},{lat:2,lng:0}]);
 assert.equal(core.contains({lat:0,lng:1},p),true);assert.equal(core.contains({lat:1,lng:0},p),true);
 assert.equal(core.contains({lat:1,lng:1.8},p),false);assert.equal(core.contains({lat:1,lng:.5},p),true);
 assert.equal(core.contains({lat:3,lng:1},p),false);
});
test('dateline polygons select the short area on either side of 180 degrees',()=>{
 const p=core.polygon([{lat:50,lng:179},{lat:52,lng:179},{lat:52,lng:-179},{lat:50,lng:-179}]);
 assert.equal(core.contains({lat:51,lng:179.5},p),true);assert.equal(core.contains({lat:51,lng:-179.5},p),true);
 assert.equal(core.contains({lat:51,lng:0},p),false);
});
test('mile measurements are finite and independent of viewport zoom',()=>{
 const d=core.dimensions([{lat:0,lng:0},{lat:1,lng:0},{lat:1,lng:1},{lat:0,lng:1}]);
 assert.ok(d.width>69&&d.width<69.2);assert.ok(d.height>69&&d.height<69.2);
 assert.equal(core.dimensions([]),null);
});
test('large area selection is sorted, complete and does not truncate the copied ZIP list',()=>{
 const points=Array.from({length:33782},(_,i)=>({zip:String(i).padStart(5,'0'),lat:30+(i%10)/100,lng:-90}));
 const selected=core.additional(core.reference(points),[{lat:29,lng:-91},{lat:31,lng:-91},{lat:31,lng:-89},{lat:29,lng:-89}],new Set());
 assert.equal(selected.length,33782);assert.equal(selected[0].zip,'00000');assert.equal(selected.at(-1).zip,'33781');
});
test('local schema upgrade is repeatable and preserves pre-map ZIPs and city/state lookup data',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try {
  sqlite.exec(html.match(/const SCHEMA = `([\s\S]*?)`;/)[1]);
  sqlite.exec("INSERT INTO subaccounts VALUES('a','A',7);INSERT INTO zip_places VALUES('a','00601','Adjuntas','Puerto Rico')");
  const db={run:sql=>sqlite.exec(sql)};
  const ctx=vm.createContext({query:(_db,sql)=>sqlite.prepare(sql).all()});
  vm.runInContext(html.match(/\/\/ BEGIN ZIP MAP STORAGE([\s\S]*?)\/\/ END ZIP MAP STORAGE/)[1]+'\nglobalThis.upgrade=migrateMapSchema;',ctx);
  ctx.upgrade(db);ctx.upgrade(db);
  const row=sqlite.prepare('SELECT * FROM zip_places').get();assert.equal(row.zip,'00601');assert.equal(row.city,'Adjuntas');assert.equal(row.lat,null);assert.equal(row.lng,null);
  assert.equal(sqlite.prepare('SELECT revision FROM subaccounts').get().revision,7);
  sqlite.prepare('UPDATE subaccounts SET home_zip=? WHERE id=?').run('00601','a');
  assert.equal(sqlite.prepare('SELECT home_zip FROM subaccounts').get().home_zip,'00601');
 }finally{sqlite.close();}
});
test('map is lazy, scoped, read-only for ZIP usage and has no Apps Script or GHL dependency',()=>{
 const module=html.slice(html.indexOf('const ZipMap ='),html.indexOf('const ZipMap =')+22000).split('// Fixed to the subaccount')[0];
 assert.ok(module.includes('pm:edit'));assert.ok(module.includes('pm:create'));assert.ok(module.includes('readonly')===false);
 assert.equal(module.includes('google.script.run'),false);assert.equal(module.includes('leadconnectorhq.com'),false);
 assert.ok(html.includes('aria-label="Open interactive ZIP map"'));assert.ok(html.includes('id="zl-summary-new"'));
 assert.equal(html.includes('<script src="https://unpkg.com/leaflet'),false);
});
