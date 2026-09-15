const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(path,deps={}) {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:n=>deps[n]});return exports;}
const books=load('src/lib/books.ts');
const {filterBooks}=load('src/lib/book-filters.ts',{'./books':books});
const filters={format:'',location:'',rating:'',author:'',language:''};
const rows=[{...books.emptyBookInput(),id:10,title:'Zulu',format:'paperback',shelfLocation:'ST-C02-S03',rating:4},{...books.emptyBookInput(),id:2,title:'Alpha',rating:2},{...books.emptyBookInput(),id:3,title:'Beta'}];
const ids=r=>Array.from(r,b=>b.id);
test('numeric sorting, case-insensitive search and permanent book numbers',()=>{
 assert.deepEqual(ids(filterBooks(rows,'',filters,'id','asc')),[2,3,10]);
 assert.deepEqual(ids(filterBooks(rows,'b000010',filters,'title','asc')),[10]);
 assert.deepEqual(ids(filterBooks(rows,'ALPHA',filters,'title','asc')),[2]);
});
test('combined filters, unrated books and missing values sorted last',()=>{
 assert.deepEqual(ids(filterBooks(rows,'',{...filters,format:'paperback',location:'ST-C02-S03',rating:'4'},'id','asc')),[10]);
 assert.deepEqual(ids(filterBooks(rows,'',{...filters,location:'__none',rating:'unrated'},'id','asc')),[3]);
 assert.deepEqual(ids(filterBooks(rows,'',filters,'rating','asc')),[2,10,3]);
 assert.deepEqual(ids(filterBooks(rows,'',filters,'rating','desc')),[10,2,3]);
 assert.deepEqual(rows.map(b=>b.id),[10,2,3]);
});


test('owner filter supports assigned, unassigned, combined filters and reset',()=>{
 const owned=rows.map((b,i)=>({...b,ownerId:i===2?null:i+1,owner:i===2?null:{id:i+1,name:i===0?'Mahira':'Nabila'}}));
 assert.deepEqual(ids(filterBooks(owned,'',{...filters,owner:'1'},'id','asc')),[10]);
 assert.deepEqual(ids(filterBooks(owned,'',{...filters,owner:'__none'},'id','asc')),[3]);
 assert.deepEqual(ids(filterBooks(owned,'',{...filters,owner:'2',rating:'4'},'id','asc')),[]);
 assert.deepEqual(ids(filterBooks(owned,'Mahira',{...filters,owner:'1'},'id','asc')),[10]);
 assert.deepEqual(ids(filterBooks(owned,'',{...filters,owner:''},'id','asc')),[2,3,10]);
});
