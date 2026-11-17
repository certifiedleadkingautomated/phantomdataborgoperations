import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const helpers=html.match(/\/\/ BEGIN ZIP INTAKE DRAFT HELPERS([\s\S]*?)\/\/ END ZIP INTAKE DRAFT HELPERS/)[1];
const preview=html.match(/\/\/ BEGIN ZIP INTAKE PREVIEW([\s\S]*?)\/\/ END ZIP INTAKE PREVIEW/)[1];
function node(tag='div',props={},...children){return {tag,props,children,value:'',textContent:'',disabled:false,classList:{toggle(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};}
const text=n=>typeof n==='string'?n:n.children.map(text).join('');
const buttons=n=>n.children.flatMap(c=>typeof c==='string'?[]:c.tag==='button'?[c]:buttons(c));
function fixture(){const context=vm.createContext({el:node,model:{busy:false}});vm.runInContext(helpers+preview+'\nglobalThis.api={removeDraftZip,serializeDraftRows,renderDraftPreview};',context);return {context,...context.api};}
test('removing a draft ZIP removes canonical aliases while preserving malformed tokens for validation',()=>{
 const f=fixture();assert.equal(f.removeDraftZip('[601],00601;"601"|bad,10001,00601-1234','00601'),'bad,10001,00601-1234');
});
test('long preview can reveal and remove a duplicate beyond the initial page, updating its source text',()=>{
 const f=fixture(),target=node(),state={},matches=new Set(['99999']);let raw=[...Array.from({length:101},(_,i)=>String(20000+i)),'99999'].join(',');
 const refresh=()=>f.renderDraftPreview(target,raw.split(','),matches,new Set(),state,z=>{raw=f.removeDraftZip(raw,z);refresh();},refresh,100,'preview');
 refresh();assert.equal(target.children[0].children.length,100);
 assert.equal(buttons(target).some(b=>b.props['aria-label']==='Remove ZIP 99999 from preview'),false);
 target.children[0].scrollTop=120;
 buttons(target).find(b=>text(b)==='Load 2 more').props.onclick();
 assert.equal(target.children[0].scrollTop,120);
 assert.equal(target.children[0].children.length,102);
 const remove=buttons(target).find(b=>b.props['aria-label']==='Remove ZIP 99999 from preview');
 assert.equal(target.children[0].children.at(-1).props.class.includes('duplicate'),true);
 remove.props.onclick();assert.equal(raw.includes('99999'),false);assert.equal(raw.split(',').length,101);
});
test('Show matches exposes hidden duplicates directly and returns to the full draft when resolved',()=>{
 const f=fixture(),target=node(),state={};let raw=[...Array.from({length:201},(_,i)=>String(20000+i)),'99999'].join(',');
 const refresh=()=>f.renderDraftPreview(target,raw.split(','),new Set(['99999']),new Set(),state,z=>{raw=f.removeDraftZip(raw,z);refresh();},refresh,100,'preview');
 refresh();buttons(target).find(b=>text(b)==='Show matches (1)').props.onclick();assert.equal(target.children[0].children.length,1);
 buttons(target).find(b=>b.props['aria-label']==='Remove ZIP 99999 from preview').props.onclick();assert.equal(target.children[0].children.length,100);
 assert.ok(buttons(target).find(b=>text(b)==='Load 100 more'));
});
test('spreadsheet row draft serialization preserves multiline quoted comments',()=>{
 const f=fixture();const result=f.serializeDraftRows([{comment:'Order "A"\nnotes\tmore',text:'00601,10001'},{comment:'Order B',text:'90210'}]);
 assert.equal(result,'"Order ""A""\nnotes\tmore"\t00601,10001\nOrder B\t90210');
});
