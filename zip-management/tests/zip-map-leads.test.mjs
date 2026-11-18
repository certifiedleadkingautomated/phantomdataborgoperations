import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const solo=existsSync(new URL('../index.html',import.meta.url));
const source=solo ? readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/\/\/ BEGIN ZIP MAP LEAD SESSION([\s\S]*?)\/\/ END ZIP MAP LEAD SESSION/)[1]
 : readFileSync(new URL('../src/components/portal/client-zips/map-leads.js',import.meta.url),'utf8').replace('export class MapLeadSession','class MapLeadSession');
const freshPage=()=>vm.runInNewContext(source+'\nMapLeadSession',{AbortController});
const Session=freshPage();let counter=0;
const context=(counts)=>({key:'synthetic-'+(++counter),ready:true,counts:new Map(Object.entries(counts).map(([zip,total])=>[zip,{total}]))});
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
test('only Used ZIPs with a verified positive total are queried; zero/unknown/New are skipped',async()=>{
 const c=context({'00601':10,'00602':0,'00603':null,'00604':40}),calls=[];
 const session=new Session(()=>{});session.update(c,['00601','00602','00603'],async zip=>{calls.push(zip);return 2;},true);await settle();
 assert.deepEqual(calls,['00601']);assert.equal(session.value('00601'),2);assert.equal(session.value('00602'),null);assert.equal(session.value('00604'),null);
 session.destroy();
});
test('closing/reopening and remounting share completed page results; a real page reload fetches again',async()=>{
 const c=context({'00601':10});let calls=0;const request=async()=>{calls++;return 1;};
 const session=new Session(()=>{});session.update(c,['00601'],request,true);await settle();
 session.update(c,['00601'],request,false);session.update(c,['00601'],request,true);await settle();assert.equal(calls,1);session.destroy();
 const remount=new Session(()=>{});remount.update(c,['00601'],request,true);await settle();assert.equal(calls,1);assert.equal(remount.value('00601'),1);remount.destroy();
 const Reloaded=freshPage(),reloaded=new Reloaded(()=>{});reloaded.update(c,['00601'],request,true);await settle();assert.equal(calls,2);reloaded.destroy();
});
test('a close/reopen while a request is in flight does not duplicate it',async()=>{
 const c=context({'00601':5});let done,calls=0;const request=()=>{calls++;return new Promise(r=>done=r);};
 const session=new Session(()=>{});session.update(c,['00601'],request,true);await settle();
 session.update(c,['00601'],request,false);session.update(c,['00601'],request,true);await settle();assert.equal(calls,1);
 done(3);await settle();assert.equal(session.value('00601'),3);session.destroy();
});
test('late totals can enable the first request; zero lead results and failures never become labels or page retries',async()=>{
 const c=context({'00601':null,'00602':2});let calls=0;
 const request=async zip=>{calls++;if(zip==='00602')throw Error('synthetic unavailable');return 0;};
 const session=new Session(()=>{});session.update(c,['00601','00602'],request,true);await settle();assert.equal(calls,1);
 c.counts.set('00601',{total:10});session.update(c,['00601','00602'],request,true);await settle();assert.equal(calls,2);
 session.update(c,['00601','00602'],request,true);await settle();assert.equal(calls,2);assert.equal(session.value('00601'),null);assert.equal(session.value('00602'),null);session.destroy();
});
test('scope/readiness/Used changes hide old results and never expose another account result',async()=>{
 const c=context({'00601':10});const session=new Session(()=>{});session.update(c,['00601'],async()=>4,true);await settle();assert.equal(session.value('00601'),4);
 c.ready=false;session.update(c,['00601'],async()=>99,true);assert.equal(session.value('00601'),null);
 c.ready=true;c.counts.set('00601',{total:0});session.update(c,['00601'],async()=>99,true);assert.equal(session.value('00601'),null);
 c.counts.set('00601',{total:10});session.update(c,[],async()=>99,true);assert.equal(session.value('00601'),null);
 const other=context({'00601':10});session.update(other,['00601'],async()=>8,true);assert.equal(session.value('00601'),null);await settle();assert.equal(session.value('00601'),8);session.destroy();
});
test('lead work is bounded to two concurrent requests and pauses queued work when the map closes',async()=>{
 const c=context(Object.fromEntries(Array.from({length:6},(_,i)=>['1000'+i,10]))),used=[...c.counts.keys()],pending=[];let calls=0,active=0,max=0;
 const request=()=>{calls++;active++;max=Math.max(max,active);return new Promise(r=>pending.push(()=>{active--;r(1);}));};
 const session=new Session(()=>{});session.update(c,used,request,true);await settle();assert.equal(calls,2);
 session.update(c,used,request,false);pending.splice(0).forEach(f=>f());await settle();assert.equal(calls,2);
 session.update(c,used,request,true);await settle();assert.equal(calls,4);
 while(pending.length){pending.splice(0).forEach(f=>f());await settle();}
 assert.equal(calls,6);assert.equal(max,2);session.destroy();
});

test('the live map adapter refuses stale account results and does not request while unverified',async()=>{
 const controller=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-controller.js',import.meta.url),'utf8');
 const start=controller.indexOf('  function leadRequest('),block=controller.slice(start,controller.indexOf('  function paintLeadPins()',start));
 let context={key:'scope-a',ready:true},done,calls=0;
 const options={getContacts:()=>context,readLeadCount:()=>{calls++;return new Promise(r=>done=r);}};
 const request=vm.runInNewContext(block+'\nleadRequest',{options})(context);
 const result=request('00601',new AbortController().signal);context={key:'scope-b',ready:true};done(100);assert.equal(await result,null);
 assert.equal(await request('00601',new AbortController().signal),null);assert.equal(calls,1);
 context={key:'scope-a',ready:false};assert.equal(await request('00601',new AbortController().signal),null);assert.equal(calls,1);
});

test('lead progress includes queued work, zero results and failed requests without starting extra reads',async()=>{
 const c=context({'00601':10,'00602':20,'00603':30,'00604':0}),used=[...c.counts.keys()];
 const pending=new Map();let calls=0;
 const session=new Session(()=>{}),request=zip=>{calls++;return new Promise((resolve,reject)=>pending.set(zip,{resolve,reject}));};
 session.update(c,used,request,true);await settle();
 assert.equal(JSON.stringify(session.progress()),JSON.stringify({ready:true,total:3,completed:0,failed:0}));assert.equal(calls,2);
 pending.get('00601').resolve(0);await settle();
 assert.equal(session.progress().completed,1);assert.equal(calls,3);
 pending.get('00602').reject(Error('synthetic failure'));pending.get('00603').resolve(4);await settle();
 assert.equal(JSON.stringify(session.progress()),JSON.stringify({ready:true,total:3,completed:3,failed:1}));
 session.update(c,used,request,false);session.update(c,used,request,true);await settle();
 assert.equal(session.progress().completed,3);assert.equal(calls,3);
 c.counts.set('00603',{total:0});session.update(c,used,request,true);assert.equal(session.progress().total,2);assert.equal(session.progress().completed,2);
 c.ready=false;session.update(c,used,request,true);assert.equal(session.progress().ready,false);assert.equal(session.progress().total,0);
 const other=context({'10001':0});session.update(other,['10001'],request,true);assert.equal(session.progress().total,0);assert.equal(session.progress().failed,0);session.destroy();
});

test('closing pauses unfinished progress and reopening resumes the original page jobs',async()=>{
 const c=context({'00601':10,'00602':20,'00603':30});let calls=0;const pending=[];
 const request=()=>{calls++;return new Promise(resolve=>pending.push(resolve));};
 const session=new Session(()=>{});session.update(c,[...c.counts.keys()],request,true);await settle();
 session.update(c,[...c.counts.keys()],request,false);pending.splice(0).forEach(resolve=>resolve(1));await settle();
 assert.equal(session.progress().completed,2);assert.equal(session.progress().total,3);assert.equal(calls,2);
 session.update(c,[...c.counts.keys()],request,true);await settle();assert.equal(calls,3);assert.equal(session.progress().completed,2);
 pending.shift()(0);await settle();assert.equal(session.progress().completed,3);session.destroy();
});

test('map search-bar status reports progress, completion, failures and waiting without changing request state',()=>{
 const controller=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-controller.js',import.meta.url),'utf8');
 const start=controller.indexOf('  function setLeadStatus('),block=controller.slice(start,controller.indexOf('  function leadRequest(',start));
 const status={textContent:'',title:'',attrs:{},setAttribute(key,value){this.attrs[key]=value;}};
 let progress={ready:true,total:12,completed:3,failed:0};
 const paint=vm.runInNewContext(block+'\npaintLeadStatus',{$:()=>status,leadSession:{progress:()=>progress}});
 paint();assert.equal(status.textContent,'Leads: 3/12 ZIPs');assert.equal(status.attrs['aria-busy'],'true');
 progress={ready:true,total:12,completed:12,failed:0};paint();assert.equal(status.textContent,'Leads loaded · 12 ZIPs');assert.equal(status.attrs['aria-busy'],'false');
 progress.failed=2;paint();assert.equal(status.textContent,'Leads finished · 2 unavailable');assert.match(status.title,/10 of 12 ZIPs/);assert.equal(status.attrs['aria-busy'],'false');
 progress={ready:true,total:0,completed:0,failed:0};paint();assert.equal(status.textContent,'Leads: no eligible ZIPs');
 progress.ready=false;paint();assert.equal(status.textContent,'Leads: waiting for contacts');assert.equal(status.attrs['aria-busy'],'false');
 const markup=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-template.ts',import.meta.url),'utf8');
 assert.match(markup,/<header class="zl-map-top">[\s\S]*?zl-map-search-form[\s\S]*?id="zl-map-lead-status"[^>]*role="status"[\s\S]*?<\/header>/);
});

test('contact updates cannot replace the loading status or resume old pins before the new map reference loads',()=>{
 const controller=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-controller.js',import.meta.url),'utf8');
 const start=controller.indexOf('  function paintLeadPins('),block=controller.slice(start,controller.indexOf('  // END ZIP MAP LEAD PINS',start));
 let calls=0;const api=vm.runInNewContext(block+'\n({paintLeadPins,refreshLeads})',{leadMapReady:false,options:{getContacts:()=>{calls++;return null;}}});
 api.paintLeadPins();api.refreshLeads();assert.equal(calls,0);
});
