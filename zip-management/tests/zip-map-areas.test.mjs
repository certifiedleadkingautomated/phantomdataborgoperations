import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const solo=existsSync(new URL('../index.html',import.meta.url));
const source=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-controller.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  // Saved shapes are scoped'),source.indexOf('  function vertices()',source.indexOf('  // Saved shapes are scoped')));
function fixture() {
  const elements=new Map();
  function node(){return {children:[],events:{},value:'',textContent:'',disabled:false,open:true,
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    setAttribute(){},addEventListener(name,fn){this.events[name]=fn;}};}
  const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const calls=[];
  const area={id:'00000000-0000-4000-8000-000000000001',name:'Saved area',vertices:[{lat:1,lng:1},{lat:1,lng:2},{lat:2,lng:1}],radius:{zip:'00601',miles:5,edited:false},available_count:12,created_at:'2026-11-13T10:00:00Z'};
  const config={readAreas:async()=>({can_manage:true,areas:[area]}),changeArea:async(action,payload)=>{calls.push({action,payload});return {can_manage:true,areas:action==='delete'?[]:[{...area,...payload}]};}};
  const context=vm.createContext({$,document:{createElement:node},crypto:{randomUUID:()=>area.id},Date,
    session:1,options:config,map:{fitBounds(){}},lookup:new Map([['00601',{}]]),polygon:{},selected:[{zip:'00601'}],radiusInfo:{zip:'00601',miles:5,edited:false},
    vertices:()=>area.vertices,colors:{selected:'purple'},L:{polygon:(points)=>({addTo(){calls.push({loaded:points});return {getBounds(){return {};}};}})},
    clearArea(){context.polygon=null;},attachArea(layer,origin){calls.push({origin});context.polygon=layer;},
  });
  vm.runInContext(block+'\nglobalThis.api={loadSaved,changeSaved,prepare(){areaReady=true;},snapshot(){return {savedAreas,areasCanManage,areasBusy};}};',context);
  return {context,$,config,calls,area,api:context.api};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('saved shapes load in the side panel; loading keeps geometry and radius metadata',async()=>{
 const f=fixture();await f.api.loadSaved(1,f.config);
 const row=f.$('zl-map-areas').children[0];
 assert.equal(row.children[0].children[1].textContent,'12 available when saved · '+new Date(f.area.created_at).toLocaleDateString());
 row.children[0].events.click();assert.deepEqual(f.calls[0].loaded,f.area.vertices);
 assert.equal(f.calls[1].origin.zip,'00601');assert.match(f.$('zl-map-area-status').textContent,/recalculated/);
});
test('saving captures the completed boundary and available count; delete leaves no saved entry',async()=>{
 const f=fixture();await f.api.loadSaved(1,f.config);f.api.prepare();f.$('zl-map-area-name').value='My area';
 f.$('zl-map-area-save').events.click();await settle();
 assert.equal(f.calls[0].action,'save');assert.equal(f.calls[0].payload.name,'My area');
 assert.equal(f.calls[0].payload.available_count,1);assert.deepEqual(f.calls[0].payload.vertices,f.area.vertices);
 f.$('zl-map-areas').children[0].children[1].events.click();await settle();
 assert.equal(f.calls[1].action,'delete');assert.equal(f.api.snapshot().savedAreas.length,0);
});
test('incomplete selections and read-only viewers cannot save/delete',async()=>{
 const f=fixture();await f.api.loadSaved(1,f.config);
 assert.equal(f.$('zl-map-area-save').disabled,true);f.$('zl-map-area-save').events.click();assert.equal(f.calls.length,0);
 f.config.readAreas=async()=>({can_manage:false,areas:[f.area]});await f.api.loadSaved(1,f.config);f.api.prepare();
 assert.equal(f.$('zl-map-areas').children[0].children[1].disabled,true);
 await f.api.changeSaved('delete',{id:f.area.id});assert.equal(f.calls.length,0);
});
test('a late saved-area response cannot repopulate a closed/switched map',async()=>{
 const f=fixture();let done;f.config.readAreas=()=>new Promise(resolve=>{done=resolve;});
 const loading=f.api.loadSaved(1,f.config);f.context.session=2;
 done({can_manage:true,areas:[f.area]});await loading;assert.equal(f.api.snapshot().savedAreas.length,0);
});
test('save errors keep the boundary usable and re-enable the save control',async()=>{
 const f=fixture();await f.api.loadSaved(1,f.config);f.api.prepare();
 f.config.changeArea=async()=>{throw Error('Unavailable');};await f.api.changeSaved('save',{id:f.area.id});
 assert.equal(f.api.snapshot().areasBusy,false);assert.equal(f.$('zl-map-area-save').disabled,false);assert.equal(f.$('zl-map-area-status').textContent,'Unavailable');
});
test('explicit retry after an uncertain save uses the same ID',async()=>{
 const f=fixture();let ids=0;f.context.crypto.randomUUID=()=> 'attempt-'+(++ids);
 await f.api.loadSaved(1,f.config);f.api.prepare();f.$('zl-map-area-name').value='Retry';
 const sent=[];f.config.changeArea=async(action,payload)=>{sent.push(payload);throw Error('Network error');};
 f.$('zl-map-area-save').events.click();await settle();f.$('zl-map-area-save').events.click();await settle();
 assert.equal(sent.length,2);assert.equal(sent[0].id,sent[1].id);assert.equal(ids,1);
});
