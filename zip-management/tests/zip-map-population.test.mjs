import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const solo=existsSync(new URL('../index.html',import.meta.url));
const source=readFileSync(new URL(solo?'../index.html':'../src/components/portal/client-zips/map-controller.js',import.meta.url),'utf8');
const core=solo
 ? vm.runInNewContext(source.match(/\/\/ BEGIN ZIP MAP CORE([\s\S]*?)\/\/ END ZIP MAP CORE/)[1]+'\nZipMapCore')
 : (await import('../src/components/portal/client-zips/map-core.js')).ZipMapCore;
test('population uses compact thousands and keeps unknown distinct from zero',()=>{
 for(const [raw,label] of [[0,'0'],[999,'999'],[1000,'1k'],[1234,'1.2k'],[12600,'12.6k'],[120000,'120k'],[1000000,'1000k'],[null,''],[undefined,''],[-1,''],[1.5,''],['1200',''],[NaN,''],[Infinity,''],[Number.MAX_SAFE_INTEGER+1,'']])
  assert.equal(core.populationLabel(raw),label);
});
test('reference and area selection preserve population per ZIP without summing a polygon',()=>{
 const rows=[{zip:'00601',lat:1,lng:1,population:1234},{zip:'00602',lat:1,lng:2,population:0},{zip:'00603',lat:1,lng:3,population:null},{zip:'00604',lat:1,lng:4,population:-1}];
 const lookup=core.reference(rows);
 const result=core.additional(lookup,[{lat:0,lng:0},{lat:2,lng:0},{lat:2,lng:5},{lat:0,lng:5}],new Set(['00601']));
 assert.deepEqual(Array.from(result,p=>p.population),[0,null,null]);
 assert.equal(lookup.get('00601').population,1234);
});
function fixture() {
 const selectedSet=new Set(['00601','00602','00603','00604']);
 const projected={blocked:new Set(['00604'])};
 const rows=[{zip:'00601',population:1234},{zip:'00602',population:0},{zip:'00603',population:null},{zip:'00604',population:9000}];
 const lookup=new Map(rows.map(p=>[p.zip,p]));
 const pin=()=>({_zipAppearance:{color:'#a855f7',home:false,active:false},current:null,setIcon(value){this.current=value;}});
 const baseMarkers=new Map(rows.map(p=>[p.zip,pin()]));
 const ctx={ZipMapCore:core,selectedSet,projected,lookup,baseMarkers,usedLeadZips:new Set(),leadSession:{value:()=>null},L:{divIcon:options=>options}};
 const helper=source.match(/\/\/ BEGIN ZIP MAP POPULATION([\s\S]*?)\/\/ END ZIP MAP POPULATION/)[1];
 const icon=source.slice(source.indexOf('  function icon('),source.indexOf('  function setError('));
 const api=vm.runInNewContext(icon+'\n'+helper+'\n({paintPopulation,refreshPopulation,icon})',ctx);
 return {...ctx,...api};
}
test('population is part of the pin silhouette with one outer outline and no separate tooltip',()=>{
 const f=fixture();f.refreshPopulation();
 const pin=f.baseMarkers.get('00601'),icon=pin.current;
 assert.match(icon.className,/zl-map-population-marker/);assert.match(icon.html,/>1\.2k<\/text>/);
 assert.equal((icon.html.match(/<path /g)||[]).length,1);
 assert.match(icon.html,/fill="#a855f7" stroke="#fff"/);assert.doesNotMatch(icon.html,/tooltip/);
 assert.match(f.baseMarkers.get('00602').current.html,/>0<\/text>/);
 for(const zip of ['00603','00604'])assert.doesNotMatch(f.baseMarkers.get(zip).current.className,/population/);
 const home=f.baseMarkers.get('00602');home._zipAppearance={home:true,color:'#e04c68',active:false};f.paintPopulation(home,f.lookup.get('00602'));
 assert.match(home.current.html,/fill="#e04c68"/);assert.match(home.current.html,/⌂/);
});
test('editing or clearing the boundary restores ordinary pins and excludes newly consumed ZIPs',()=>{
 const f=fixture();f.refreshPopulation();f.selectedSet.delete('00601');f.projected.blocked.add('00602');f.refreshPopulation();
 for(const zip of ['00601','00602'])assert.doesNotMatch(f.baseMarkers.get(zip).current.className,/population/);
 f.selectedSet.clear();f.refreshPopulation();
 assert.ok([...f.baseMarkers.values()].every(p=>!p.current.className.includes('population')));
});
test('radius-origin uses the same joined shape in gold and unknown points return to the ordinary icon',()=>{
 const f=fixture(),pin=f.baseMarkers.get('00601');pin._zipAppearance.active=true;
 f.paintPopulation(pin,f.lookup.get('00601'));assert.match(pin.current.html,/fill="#d59a15"/);assert.equal(pin.current.iconSize[1],48);
 f.paintPopulation(pin,undefined);assert.doesNotMatch(pin.current.className,/population/);assert.match(pin.current.className,/zl-radius-origin/);
});
test('selected population sums unique ZIPs, preserves zero and distinguishes missing values',()=>{
 const rows=[{zip:'00601',population:1234},{zip:'00601',population:1234},{zip:'00602',population:500},{zip:'00603',population:0}];
 const sum=core.sumPopulation(rows);assert.equal(sum.total,1734);assert.equal(sum.known,3);assert.equal(sum.size,3);
 assert.equal(core.populationSummary(rows),'Population: '+(1734).toLocaleString()+'.');
 assert.equal(core.populationSummary([]),'Population: 0.');
 assert.equal(core.populationSummary([{zip:'00601',population:0}]),'Population: 0.');
 assert.equal(core.populationSummary([...rows,{zip:'00604',population:null}]),'Known population: '+(1734).toLocaleString()+' (3 of 4 ZIPs).');
 assert.equal(core.populationSummary([{zip:'00601',population:null}]),'Population unavailable (0 of 1 ZIPs).');
});
test('unsafe population sums are unavailable rather than rounded or reported as zero',()=>{
 const rows=[{zip:'00601',population:Number.MAX_SAFE_INTEGER},{zip:'00602',population:1}];
 assert.equal(core.sumPopulation(rows).total,null);assert.equal(core.populationSummary(rows),'Population unavailable.');
});
test('actual selection description totals additional ZIPs and recalculates on boundary edits',()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{open:true,textContent:'',value:''});return elements.get(id);};
 const ring=[{lat:0,lng:0},{lat:2,lng:0},{lat:2,lng:5},{lat:0,lng:5}];
 const rows=[{zip:'00601',lat:1,lng:1,population:1200},{zip:'00602',lat:1,lng:2,population:800},{zip:'00603',lat:1,lng:3,population:5000}];
 const ctx={ZipMapCore:core,$,polygon:{},lookup:core.reference(rows),vertices:()=>ring,projected:{blocked:new Set(['00603'])},selectionVersion:0,selected:[],selectedSet:new Set(),radiusInfo:null,areaReady:false,refreshPopulation(){},savedButtons(){},renderAreaPins(){},updateSearch(){}};
 const start=source.indexOf('  function selectArea()');const block=source.slice(start,source.indexOf('  function renderAreaPins()',start));
 const select=vm.runInNewContext(block+'\nselectArea',ctx);select();
 assert.match($('zl-map-help').textContent,/2 additional ZIPs\. Population: 2,000\./);
 ctx.projected.blocked.add('00602');select();assert.match($('zl-map-help').textContent,/1 additional ZIPs\. Population: 1,200\./);
 ring.splice(0,ring.length,{lat:5,lng:0},{lat:6,lng:0},{lat:6,lng:1});select();assert.match($('zl-map-help').textContent,/0 additional ZIPs\. Population: 0\./);
});

test('Used lead labels use the same integrated SVG and singular/plural text; New/zero stay unlabelled',()=>{
 const f=fixture(),pin=f.baseMarkers.get('00601');f.usedLeadZips.add('00601');pin._zipAppearance.color='#3388ff';
 let count=1;f.leadSession.value=()=>count;f.paintPopulation(pin,f.lookup.get('00601'));assert.match(pin.current.html,/>1 lead<\/text>/);assert.match(pin.current.html,/fill="#3388ff"/);
 count=2;f.paintPopulation(pin,f.lookup.get('00601'));assert.match(pin.current.html,/>2 leads<\/text>/);
 count=null;f.paintPopulation(pin,f.lookup.get('00601'));assert.doesNotMatch(pin.current.className,/population/);
 f.usedLeadZips.clear();f.projected.blocked.add('00601');count=2;f.paintPopulation(pin,f.lookup.get('00601'));assert.doesNotMatch(pin.current.className,/population/);
});
