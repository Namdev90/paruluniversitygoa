const hex=b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
export const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(value){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256));}
export async function passwordMatches(password,stored){const hash=await passwordHash(password,stored.salt||'0'.repeat(32));const expected=stored.hash||'0'.repeat(64);let diff=hash.length^expected.length;for(let i=0;i<hash.length;i++)diff|=hash.charCodeAt(i)^(expected.charCodeAt(i)||0);return diff===0;}
const actions=new Set(['config','login','checker-login','google-login','checker-profile','me','logout','sync','checkin','import','upsert','staff-create','staff-update','staff-request','admin-password','helpdesk-save','helpdesk-list','helpdesk-edit','helpdesk-review','helpdesk-export','reports-access','reports-summary','reports-export','reports-members','reports-grant','reports-request']);
export function validateRequest(body){
 if(!body||!actions.has(body.action))throw Error('Unknown action.');
 if(!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))throw Error('Invalid payload.');
 const p=body.payload;
 if(body.action==='reports-export'&&!['all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending','corrections'].includes(p.kind))throw Error('Invalid report dataset.');
 if(body.action==='reports-request'&&Object.keys(p).length!==0)throw Error('Faculty requests do not accept permissions or account identifiers.');
 if(body.action.startsWith('reports-')&&JSON.stringify(p).length>2000)throw Error('Report request is too large.');
 if(body.action==='reports-grant'&&(typeof p.checkerId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.checkerId)||typeof p.enabled!=='boolean'))throw Error('Invalid teacher approval.');
 if(body.action.startsWith('helpdesk-')){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(JSON.stringify(p).length>12000)throw Error('Help desk request is too large.');
  if(body.action==='helpdesk-save'&&!uuid.test(p.requestId))throw Error('Invalid registration request ID.');
  if(['helpdesk-edit','helpdesk-review'].includes(body.action)&&(!uuid.test(p.id)||!Number.isSafeInteger(p.version)||p.version<1))throw Error('Invalid registration version. Refresh and retry.');
  if(body.action==='helpdesk-review'&&!['approved','rejected'].includes(p.status))throw Error('Choose approve or reject.');
  if(body.action==='helpdesk-list'){
   if(p.limit!=null&&(!Number.isSafeInteger(p.limit)||p.limit<1||p.limit>8))throw Error('Invalid page size.');
   if(p.offset!=null&&(!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>100000))throw Error('Invalid page.');
   if(p.search!=null&&(typeof p.search!=='string'||p.search.length>128))throw Error('Search is too long.');
   if(p.status!=null&&!['all','pending','approved','rejected'].includes(p.status))throw Error('Invalid status.');
  }
 }
 if(body.action==='checker-profile'&&(typeof p.name!=='string'||! /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u.test(p.name.trim())))throw Error('Enter your real name, up to 40 letters.');
 if(body.action==='staff-request'&&!['checker','helpdesk'].includes(p.station))throw Error('Choose Checker or Help Desk.');
 if(['staff-create','staff-update'].includes(body.action)&&p.name!=null&&(typeof p.name!=='string'||! /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u.test(p.name.trim())))throw Error('Enter a real staff name, up to 40 letters.');
 if(body.action==='checkin'){
  if(typeof p.ticketId!=='string'||!/^[A-Z0-9]{8}$/.test(p.ticketId))throw Error('Invalid ticket ID.');
  if(typeof p.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.requestId))throw Error('Invalid request ID.');
  if(typeof p.deviceId!=='string'||!p.deviceId||p.deviceId.length>128)throw Error('Invalid device ID.');
 }
 for(const field of ['username','password','code','name','accessToken'])if(p[field]!=null&&(typeof p[field]!=='string'||p[field].length>(field==='accessToken'?10000:256)))throw Error('Invalid '+field+'.');
 for(const field of ['dataRevision','afterSeq'])if(p[field]!=null&&(!Number.isSafeInteger(p[field])||p[field]<-1))throw Error('Invalid sync cursor.');
 return body;
}
