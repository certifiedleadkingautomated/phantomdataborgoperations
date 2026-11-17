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
 const pin=()=>({tooltip:null,getTooltip(){return this.tooltip;},unbindTooltip(){this.tooltip=null;},bindTooltip(text,options){this.tooltip={text,options};}});
 const baseMarkers=new Map(rows.map(p=>[p.zip,pin()]));
 const ctx={ZipMapCore:core,selectedSet,projected,lookup,baseMarkers};
 const helper=source.match(/\/\/ BEGIN ZIP MAP POPULATION([\s\S]*?)\/\/ END ZIP MAP POPULATION/)[1];
 const api=vm.runInNewContext(helper+'\n({paintPopulation,refreshPopulation})',ctx);
 return {...ctx,...api};
}
test('only available selected pins get quiet permanent labels, including a selected Home/search pin',()=>{
 const f=fixture();f.refreshPopulation();
 const label=f.baseMarkers.get('00601').tooltip;
 assert.equal(label.text,'1.2k');assert.equal(label.options.className,'zl-map-population');
 assert.equal(label.options.permanent,true);assert.equal(label.options.interactive,false);
 assert.deepEqual(Array.from(label.options.offset),[0,-34]);
 assert.equal(f.baseMarkers.get('00602').tooltip.text,'0');
 assert.equal(f.baseMarkers.get('00603').tooltip,null);assert.equal(f.baseMarkers.get('00604').tooltip,null);
 const searchPin={...f.baseMarkers.get('00601'),tooltip:null};
 f.paintPopulation(searchPin,f.lookup.get('00601'));assert.equal(searchPin.tooltip.text,'1.2k');
});
test('editing or clearing a boundary removes labels and excludes newly consumed ZIPs',()=>{
 const f=fixture();f.refreshPopulation();f.selectedSet.delete('00601');f.projected.blocked.add('00602');f.refreshPopulation();
 assert.equal(f.baseMarkers.get('00601').tooltip,null);assert.equal(f.baseMarkers.get('00602').tooltip,null);
 f.selectedSet.clear();f.refreshPopulation();
 assert.ok([...f.baseMarkers.values()].every(p=>p.tooltip===null));
});

test('population label clears the taller radius-origin icon and is removed for an unknown point',()=>{
 const f=fixture(),pin=f.baseMarkers.get('00601');pin._zipAppearance={active:true};
 f.paintPopulation(pin,f.lookup.get('00601'));assert.equal(pin.tooltip.options.offset[1],-44);
 f.paintPopulation(pin,undefined);assert.equal(pin.tooltip,null);
});
