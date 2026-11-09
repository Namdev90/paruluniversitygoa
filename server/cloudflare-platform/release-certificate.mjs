// SHA-256 of the original APK signing X.509 certificate, also pinned by tools/release_policy.py.
export const ORIGINAL_CERTIFICATE_SHA256='0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce';
const RSA='2a864886f70d010101',EC='2a8648ce3d0201';
const CURVES={'2a8648ce3d030107':'P-256','2b81040022':'P-384','2b81040023':'P-521'};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
function item(data,start,limit){
 if(start>=limit)throw Error('Malformed certificate');const tag=data[start++];if(start>=limit)throw Error('Malformed certificate');
 let size=data[start++];if(size>=128){const count=size&127;if(count<1||count>2||start+count>limit||data[start]===0)throw Error('Malformed certificate');
  size=0;for(let i=0;i<count;i++)size=size*256+data[start++];if(size<128)throw Error('Malformed certificate');}
 const end=start+size;if(end>limit)throw Error('Malformed certificate');return{tag,start,end};
}
function expect(data,start,limit,tag){const value=item(data,start,limit);if(value.tag!==tag)throw Error('Malformed certificate');return value;}
function extract(certificate){
 const outer=expect(certificate,0,certificate.length,0x30);if(outer.end!==certificate.length)throw Error('Malformed certificate');
 const tbs=expect(certificate,outer.start,outer.end,0x30);let cursor=tbs.start;
 if(certificate[cursor]===0xa0){const version=item(certificate,cursor,tbs.end);const integer=expect(certificate,version.start,version.end,0x02);if(integer.end!==version.end)throw Error('Malformed certificate');cursor=version.end;}
 for(const tag of [0x02,0x30,0x30,0x30,0x30])cursor=expect(certificate,cursor,tbs.end,tag).end;
 const spkiStart=cursor,spki=expect(certificate,cursor,tbs.end,0x30);cursor=spki.end;
 while(cursor<tbs.end)cursor=item(certificate,cursor,tbs.end).end;
 const outerAlg=expect(certificate,tbs.end,outer.end,0x30),outerSig=expect(certificate,outerAlg.end,outer.end,0x03);
 if(outerSig.end!==outer.end||outerSig.end-outerSig.start<1||certificate[outerSig.start]>7)throw Error('Malformed certificate');
 const alg=expect(certificate,spki.start,spki.end,0x30),key=expect(certificate,alg.end,spki.end,0x03);
 if(key.end!==spki.end||key.end-key.start<2||certificate[key.start]!==0)throw Error('Malformed certificate');
 const oid=expect(certificate,alg.start,alg.end,0x06),name=hex(certificate.subarray(oid.start,oid.end));let params=oid.end;
 let algorithm;
 if(name===RSA){if(params<alg.end){const n=expect(certificate,params,alg.end,0x05);if(n.start!==n.end)throw Error('Malformed certificate');params=n.end;}
  algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
 }else if(name===EC){const o=expect(certificate,params,alg.end,0x06),curve=CURVES[hex(certificate.subarray(o.start,o.end))];if(!curve)throw Error('Unsupported certificate');params=o.end;algorithm={name:'ECDSA',namedCurve:curve};}
 else throw Error('Unsupported certificate');
 if(params!==alg.end)throw Error('Malformed certificate');return{spki:certificate.slice(spkiStart,spki.end),algorithm};
}
/** Public certificate only; no private-key discovery, import or generation. */
export async function importOriginalReleaseSigner(base64,{subtle=globalThis.crypto?.subtle}={}){
 if(typeof base64!=='string'||base64.length>21848||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)||
  typeof subtle?.digest!=='function'||typeof subtle?.importKey!=='function')throw Error('Original signer certificate required');
 const decoded=atob(base64);if(decoded.length<32||decoded.length>16384)throw Error('Original signer certificate required');
 const data=Uint8Array.from(decoded,c=>c.charCodeAt(0));
 const hash=new Uint8Array(await subtle.digest('SHA-256',data));if(hash.length!==32||hex(hash)!==ORIGINAL_CERTIFICATE_SHA256)throw Error('Original signer certificate mismatch');
 const {spki,algorithm}=extract(data);
 return subtle.importKey('spki',spki,algorithm,false,['verify']);
}
