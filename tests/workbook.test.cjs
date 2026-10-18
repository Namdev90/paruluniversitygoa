const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const path=require('node:path');
let W;try{W=require('../app/assets/workbook.js');}catch{W={};}
const file=process.env.NAVRANG_TEST_XLSX||path.join(__dirname,'../test-data/Link_Transactions_Report-2026-04-16-To-2026-10-16.xlsx');
test('actual supplied export parses 997 transactions with 926 eligible and 71 blocked',{skip:!fs.existsSync(file)},()=>{
 assert.equal(typeof W.parse,'function');
 const b=W.parse(fs.readFileSync(file));assert.equal(b.total,997);assert.equal(b.eligible,926);assert.equal(b.blocked,71);assert.equal(Object.values(b.records).filter(r=>r.eligible).length,926);
});
test('not an XLSX and empty data are rejected',()=>{assert.throws(()=>W.parse(new TextEncoder().encode('not excel')),/original .xlsx/);assert.throws(()=>W.parse(new Uint8Array()),/non-empty/);});
const latest=process.env.NAVRANG_LATEST_XLSX;
test('latest authorized export adds 127 records and keeps prior canonical records unchanged',{skip:!latest||!fs.existsSync(latest)||!fs.existsSync(file)},()=>{const newer=W.parse(fs.readFileSync(latest)),older=W.parse(fs.readFileSync(file));assert.equal(newer.total,1124);assert.equal(newer.eligible,1041);assert.equal(newer.blocked,83);assert.equal(Object.keys(newer.records).filter(id=>!older.records[id]).length,127);for(const id of Object.keys(older.records))for(const key of ['name','amount','quantity','refund','description','eligible'])assert.deepEqual(newer.records[id][key],older.records[id][key])});

const XLSX=require('../app/assets/vendor/xlsx.full.min.js'),pako=require('../app/assets/vendor/pako_inflate.min.js');
const {deflateRawSync,constants}=require('node:zlib'),vm=require('node:vm');
const row={TransactionID:'DEMO0001',Customer:'Synthetic Student',LinkID:'O9KL3',Amount:100,Quantity:1,RefundAmount:0,Description:'Transaction completed successfully'};
function workbook(compression){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([row]),'Link_Transactions');return XLSX.write(book,{type:'buffer',bookType:'xlsx',compression});}
function crc32(data){let crc=-1;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return (crc^-1)>>>0;}
// Build archives independently of the production ZIP reader, including forged metadata.
function zip(members){
 const locals=[],directory=[];let offset=0;
 for(const m of members){
  const name=Buffer.from(m.name),data=m.data||Buffer.from('x'),method=m.method??8,flags=m.flags||0,extra=m.extra||Buffer.alloc(0);
  const compressed=m.compressed|| (method===0?data:deflateRawSync(data)),size=m.size??data.length,crc=crc32(data);
  const local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);
  local.writeUInt32LE(flags&8?0:crc,14);local.writeUInt32LE(flags&8?0:compressed.length,18);local.writeUInt32LE(m.localSize??(flags&8?0:size),22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(extra.length,28);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(extra.length,30);central.writeUInt32LE(offset,42);
  locals.push(local,name,extra,compressed);directory.push(central,name,extra);offset+=local.length+name.length+extra.length+compressed.length;
  if(flags&8){const descriptor=Buffer.alloc(m.unsignedDescriptor?12:16),p=m.unsignedDescriptor?0:4;if(p)descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,p);descriptor.writeUInt32LE(compressed.length,p+4);descriptor.writeUInt32LE(size,p+8);locals.push(descriptor);offset+=descriptor.length;}
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(members.length,8);end.writeUInt16LE(members.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,central,end]);
}
function guardedParser(){
 const seen={inflaters:0,chunks:0,bytes:0,parses:0};
 class Inflate extends pako.Inflate{constructor(options){super(options);seen.inflaters++;Object.defineProperty(this,'onData',{set(callback){this.emit=chunk=>{seen.chunks++;seen.bytes+=chunk.length;callback(chunk);};},get(){return this.emit;}});}}
 const context={TextDecoder,NavrangCore:require('../app/assets/core.js'),XLSX:{CFB:XLSX.CFB,parse_zip(){seen.parses++;throw Error('Unexpected SheetJS parse');}},pako:{Inflate}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/assets/workbook.js'),'utf8'),context);
 return {parse:context.NavrangWorkbook.parse,seen};
}
const contentTypes={name:'[Content_Types].xml',data:Buffer.from('<Types/>')};

test('synthetic stored and deflated workbooks preserve normalized transactions',()=>{
 for(const compression of [false,true]){const b=W.parse(workbook(compression));assert.equal(b.total,1);assert.equal(b.eligible,1);assert.equal(b.records.DEMO0001.name,row.Customer);}
});
test('member and aggregate expansion limits reject metadata before inflation or SheetJS',()=>{
 for(const members of [
  [{name:'huge',size:512*1024*1024},contentTypes],
  [contentTypes,...Array.from({length:3},(_,i)=>({name:'part'+i,size:12*1024*1024}))],
  [contentTypes,{name:'huge',size:0xffffffff}],
 ]){const guard=guardedParser();assert.throws(()=>guard.parse(zip(members)),/exceed the import limit/);assert.deepEqual(guard.seen,{inflaters:0,chunks:0,bytes:0,parses:0});}
});
test('lying small sizes abort on the first bounded output chunk',()=>{
 for(const size of [0,1,16384]){
  const guard=guardedParser(),data=Buffer.alloc(2*1024*1024);
  assert.throws(()=>guard.parse(zip([{name:'bomb',data,size},contentTypes])),/Invalid.*ZIP/);
  assert.equal(guard.seen.parses,0);assert.ok(guard.seen.bytes<=size+16384);assert.equal(guard.seen.inflaters,1);
 }
});
test('inconsistent headers, unsupported ZIP features and truncated streams are rejected',()=>{
 const badMembers=[
  {name:'bad',size:1,localSize:1024*1024*512},
  {name:'bad',data:Buffer.from('two'),size:4},
  {name:'bad',method:0,size:2},
  {name:'bad',flags:1},
  {name:'bad',method:99},
  {name:'bad',extra:Buffer.from([1,0,8,0,0,0,0,0,0,0,0,0])},
  {name:'bad',compressed:deflateRawSync(Buffer.from('payload')).subarray(0,2)},
  {name:'bad',compressed:Buffer.concat([deflateRawSync(Buffer.from('x')),Buffer.from('junk')])},
  {name:'../bad'},
 ];
 for(const m of badMembers)assert.throws(()=>W.parse(zip([m,contentTypes])),/Invalid.*ZIP/);
 for(const data of [Buffer.from('PK'),workbook(true).subarray(0,50),zip([contentTypes,{...contentTypes,name:'[CONTENT_TYPES].xml'}]),zip(Array.from({length:1025},(_,i)=>({name:'part'+i})))])assert.throws(()=>W.parse(data),/Invalid.*ZIP/);
 const corrupt=workbook(false);corrupt[50]^=1;assert.throws(()=>W.parse(corrupt),/Invalid.*ZIP/);
});
test('SheetJS cannot recursively expand a nested archive through a format fallback',()=>{
 for(const members of [[{name:'Index.zip',data:workbook(true)}],[contentTypes,{name:'META-INF/manifest.xml'}],[contentTypes,{name:'objectdata.xml'}],[contentTypes,{name:'Index/Document.iwa'}]]){
  const guard=guardedParser();assert.throws(()=>guard.parse(zip(members)),/Invalid.*ZIP/);assert.equal(guard.seen.parses,0);assert.equal(guard.seen.inflaters,0);
 }
});
test('standard DEFLATE modes and signed or unsigned data descriptors import correctly',()=>{
 const source=XLSX.CFB.read(workbook(false),{type:'buffer'}),members=source.FullPaths.slice(2).map((name,i)=>({name:name.replace(/^Root Entry\//,''),data:Buffer.from(source.FileIndex[i+2].content)}));
 for(const options of [{level:0},{strategy:constants.Z_FIXED},{level:9}])for(const unsignedDescriptor of [false,true]){
  const bytes=zip(members.map(m=>({...m,flags:8,unsignedDescriptor,compressed:deflateRawSync(m.data,options)})));assert.equal(W.parse(bytes).eligible,1);
 }
});
test('legacy browser loads bounded inflater before synchronous workbook parsing',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../app/assets/legacy.html'),'utf8'),{runScripts:'outside-only'});
 try{
  const w=dom.window;w.TextDecoder=TextDecoder;
  for(const script of w.document.querySelectorAll('script[src]')){if(script.getAttribute('src')==='store.js')break;w.eval(fs.readFileSync(path.join(__dirname,'../app/assets',script.getAttribute('src')),'utf8'));}
  assert.equal(w.NavrangWorkbook.parse(workbook(true)).eligible,1);
  assert.throws(()=>w.NavrangWorkbook.parse(zip([{name:'huge',size:512*1024*1024},contentTypes])),/exceed the import limit/);
 }finally{dom.window.close();}
});
