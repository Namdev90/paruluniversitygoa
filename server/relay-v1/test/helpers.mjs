// SPDX-License-Identifier: MIT
import { DatabaseSync } from 'node:sqlite';
import { SqlMetadataStore } from '../src/storage.mjs';
import { RelayCore } from '../src/core.mjs';
export function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = {exec(query,...args) { const stmt = db.prepare(query); return {toArray:()=>stmt.all(...args)}; }};
  // SqlMetadataStore expects exec writes to execute immediately, as Cloudflare SQL does.
  sql.exec = (query,...args) => {const stmt = db.prepare(query); const rows = stmt.all(...args); return {toArray:()=>rows};};
  const store = new SqlMetadataStore(sql), peers = new Map();
  let time = 1000000, id = 0;
  const core = new RelayCore(store,peers,()=>time,()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`);
  function peer(role, subject=role, overrides={}) {
    const p = {id:`session${++id}`,subject,room:'room',role,version:1,jti:`identity${id}`,expires:time+300000,alive:true,messages:[],...overrides};
    p.open = () => p.alive;
    p.close = (code,reason) => {p.alive=false;p.closed={code,reason};};
    p.send = data => {p.messages.push(data);p.onSend?.(data);};
    p.persist = () => {p.attachment = structuredClone({id:p.id,subject:p.subject,room:p.room,role:p.role,version:p.version,jti:p.jti,expires:p.expires,flow:p.flow});};
    return p;
  }
  const add = (role,subject,overrides) => {const p=peer(role,subject,overrides);core.connect(p);return p;};
  const setup = () => {const c=add('controller'),s=add('speaker'),l=add('listener');core.message(c,JSON.stringify({type:'grant',subject:s.subject}));return {c,s,l,g:structuredClone(core.state.grant)};};
  return {db,store,peers,core,peer,add,setup,now:()=>time,advance:ms=>time+=ms,setTime:n=>time=n};
}
export function frame(g,sequence=1,size=4) {
  const b=new Uint8Array(40+size),v=new DataView(b.buffer);
  b.set([78,86,82,71,1,1,0,40]);v.setUint32(8,g.epoch);v.setUint32(12,sequence);v.setBigUint64(16,BigInt(g.deadline));
  b.set(g.grantId.replace(/-/g,'').match(/../g).map(x=>parseInt(x,16)),24);
  b.fill(0xa5,40);return b.buffer;
}
export const binaries = p => p.messages.filter(m=>m instanceof ArrayBuffer);
export const ack = (core,p,g,sequence) => core.message(p,JSON.stringify({type:'ack',epoch:g.epoch,sequence}));
