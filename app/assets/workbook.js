(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./vendor/xlsx.full.min.js'),require('./vendor/pako_inflate.min.js'));else root.NavrangWorkbook=factory(root.NavrangCore,root.XLSX,root.pako);})(globalThis,function(Core,XLSX,pako){
 'use strict';
 const MEMBER_LIMIT=16*1024*1024,TOTAL_LIMIT=32*1024*1024,ENTRY_LIMIT=1024;
 const invalid=()=>{throw Error('Invalid or unsupported XLSX ZIP archive. Choose the original Excel export.');};
 const tooLarge=()=>{throw Error('Excel ZIP contents exceed the import limit (16 MB per file, 32 MB total).');};
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(data){let crc=-1;for(const b of data)crc=(crc>>>8)^crcTable[(crc^b)&255];return (crc^-1)>>>0;}
 function boundedZip(b){
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength),u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
  const fits=(p,n,end=b.length)=>{if(p<0||p+n>end)invalid();};
  // Read the directory first: never allocate from unchecked local-header sizes.
  let end=b.length-22;
  for(;end>=Math.max(0,b.length-65557);end--)if(u32(end)===0x06054b50&&end+22+u16(end+20)===b.length)break;
  if(end<Math.max(0,b.length-65557))invalid();
  const count=u16(end+10),directory=u32(end+16);
  if(u16(end+4)||u16(end+6)||u16(end+8)!==count||!count||count>ENTRY_LIMIT||directory+u32(end+12)!==end)invalid();
  const entries=[],names=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});let pos=directory,total=0;
  const extra=(start,length)=>{const stop=start+length;for(let p=start;p<stop;){fits(p,4,stop);const size=u16(p+2);if(u16(p)===1)invalid();fits(p+4,size,stop);p+=4+size;}};
  for(let i=0;i<count;i++){
   fits(pos,46,end);if(u32(pos)!==0x02014b50)invalid();
   const flags=u16(pos+8),method=u16(pos+10),crc=u32(pos+16),compressed=u32(pos+20),size=u32(pos+24),nameLength=u16(pos+28),extraLength=u16(pos+30),commentLength=u16(pos+32),offset=u32(pos+42);
   fits(pos+46,nameLength+extraLength+commentLength,end);
   if(flags&~0x080e||method!==0&&method!==8||u16(pos+34)||!nameLength||compressed===0xffffffff||offset===0xffffffff)invalid();
   if(size>MEMBER_LIMIT||(total+=size)>TOTAL_LIMIT)tooLarge();
   let name;try{name=decoder.decode(b.subarray(pos+46,pos+46+nameLength));}catch{invalid();}
   if(/[\x00-\x1f\\]/.test(name)||name.startsWith('/')||name.split('/').some(p=>p==='.'||p==='..')||names.has(name.toLowerCase()))invalid();
   names.add(name.toLowerCase());extra(pos+46+nameLength,extraLength);
   fits(offset,30,directory);if(u32(offset)!==0x04034b50||u16(offset+6)!==flags||u16(offset+8)!==method||u16(offset+26)!==nameLength)invalid();
   const localExtra=u16(offset+28),start=offset+30+nameLength+localExtra;
   fits(offset+30,nameLength+localExtra,directory);fits(start,compressed,directory);
   for(let j=0;j<nameLength;j++)if(b[offset+30+j]!==b[pos+46+j])invalid();
   extra(offset+30+nameLength,localExtra);
   const localCrc=u32(offset+14),localCompressed=u32(offset+18),localSize=u32(offset+22);
   if(flags&8){if(localCrc&&localCrc!==crc||localCompressed&&localCompressed!==compressed||localSize&&localSize!==size)invalid();}
   else if(localCrc!==crc||localCompressed!==compressed||localSize!==size)invalid();
   let stop=start+compressed;
   if(flags&8){fits(stop,12,directory);if(u32(stop)===0x08074b50)stop+=4;fits(stop,12,directory);if(u32(stop)!==crc||u32(stop+4)!==compressed||u32(stop+8)!==size)invalid();stop+=12;}
   if(method===0&&compressed!==size)invalid();
   entries.push({name,method,crc,size,offset,start,stop,compressed});pos+=46+nameLength+extraLength+commentLength;
  }
  if(pos!==end)invalid();
  // Keep SheetJS on its OOXML path; other containers can recursively unzip data.
  if(!names.has('[content_types].xml')||names.has('meta-inf/manifest.xml')||names.has('objectdata.xml')||names.has('index/document.iwa'))invalid();
  entries.sort((a,b)=>a.offset-b.offset);let previous=0;
  for(const entry of entries){if(entry.offset!==previous)invalid();previous=entry.stop;}if(previous!==directory)invalid();
  const zip=XLSX.CFB.utils.cfb_new();let expanded=0;
  for(const entry of entries){
   const data=b.subarray(entry.start,entry.start+entry.compressed);let content;
   if(entry.method===0){content=data;expanded+=data.length;}
   else{
    // Pako allocates fixed 16 KiB output chunks and a 32 KiB sliding window.
    // Check each chunk before copying; forged small sizes cannot grow the buffer.
    content=new Uint8Array(entry.size);let written=0;
    const inflater=new pako.Inflate({raw:true,chunkSize:16384});
    inflater.onData=chunk=>{if(written+chunk.length>entry.size||expanded+chunk.length>TOTAL_LIMIT)invalid();content.set(chunk,written);written+=chunk.length;expanded+=chunk.length;};
    inflater.push(data,true);
    if(inflater.err||!inflater.ended||inflater.strm.avail_in||written!==entry.size)invalid();
   }
   if(crc32(content)!==entry.crc)invalid();
   XLSX.CFB.utils.cfb_add(zip,entry.name,content,{unsafe:true});
  }
  return zip;
 }
 return {parse(bytes){
  if(!bytes||bytes.byteLength===0||bytes.byteLength>8*1024*1024)throw Error('Choose a non-empty Excel file smaller than 8 MB.');
  const b=new Uint8Array(bytes);if(b[0]!==80||b[1]!==75)throw Error('Choose the original .xlsx Excel export, not a photo, PDF or renamed file.');
  const wb=XLSX.parse_zip(boundedZip(b),{dense:false,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:50002});
  const sheet=wb.Sheets.Link_Transactions;if(!sheet)throw Error('Missing Link_Transactions sheet. Choose the original Easebuzz Excel export.');
  if(sheet['!fullref']&&XLSX.utils.decode_range(sheet['!fullref']).e.r>50000)throw Error('This prototype accepts up to 50,000 transaction rows.');
  return Core.normalizeRows(XLSX.utils.sheet_to_json(sheet,{defval:null,raw:true}));
 }};
});
