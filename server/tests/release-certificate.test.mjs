import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importOriginalReleaseSigner,ORIGINAL_CERTIFICATE_SHA256} from '../cloudflare-platform/release-certificate.mjs';
const pin=Uint8Array.from(Buffer.from(ORIGINAL_CERTIFICATE_SHA256,'hex'));
const tlv=(tag,...values)=>{const bytes=values.flat(),n=bytes.length;return [tag,...(n<128?[n]:n<256?[0x81,n]:[0x82,n>>8,n&255]),...bytes];};
const rsaOid=[0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01],ecOid=[0x2a,0x86,0x48,0xce,0x3d,0x02,0x01];
const p256=[0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07];
function certificate(type='rsa'){
 const alg=type==='rsa'?tlv(0x30,tlv(0x06,rsaOid),tlv(0x05)):tlv(0x30,tlv(0x06,ecOid),tlv(0x06,p256));
 const spki=tlv(0x30,alg,tlv(0x03,0,1,2,3));
 const tbs=tlv(0x30,tlv(0xa0,tlv(0x02,2)),tlv(0x02,1),alg,tlv(0x30),tlv(0x30),tlv(0x30),spki);
 return {cert:Uint8Array.from(tlv(0x30,tbs,alg,tlv(0x03,0,1,2))),spki:Uint8Array.from(spki)};
}
function subtle({valid=true}={}){
 const calls=[];return {calls,async digest(name,data){calls.push({name,size:data.length});return valid?pin:new Uint8Array(32);},
  async importKey(format,data,algorithm,extractable,usages){calls.push({format,data:new Uint8Array(data),algorithm,extractable,usages});return {synthetic:true};}};
}
test('pins entire certificate before importing its embedded RSA SPKI nonextractably',async()=>{
 const {cert,spki}=certificate(),api=subtle();assert.deepEqual(await importOriginalReleaseSigner(Buffer.from(cert).toString('base64'),{subtle:api}),{synthetic:true});
 assert.equal(api.calls[0].name,'SHA-256');assert.equal(api.calls[1].format,'spki');assert.deepEqual(api.calls[1].data,spki);
 assert.deepEqual(api.calls[1].algorithm,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'});assert.equal(api.calls[1].extractable,false);assert.deepEqual(api.calls[1].usages,['verify']);
});
test('derives EC P-256 from pinned certificate, never caller-supplied algorithm',async()=>{
 const {cert}=certificate('ec'),api=subtle();await importOriginalReleaseSigner(Buffer.from(cert).toString('base64'),{subtle:api,algorithm:'RSA',curve:'P-521'});
 assert.deepEqual(api.calls[1].algorithm,{name:'ECDSA',namedCurve:'P-256'});
});
test('wrong pin, malformed base64 and oversize fail before public key import',async()=>{
 const {cert}=certificate(),api=subtle({valid:false});await assert.rejects(importOriginalReleaseSigner(Buffer.from(cert).toString('base64'),{subtle:api}));assert.equal(api.calls.length,1);
 for(const value of ['abc!','',Buffer.alloc(16385).toString('base64')])await assert.rejects(importOriginalReleaseSigner(value,{subtle:subtle()}));
});
test('strict certificate framing rejects trailing, truncated, invalid length or unknown key type',async()=>{
 const {cert}=certificate();const examples=[Uint8Array.from([...cert,0]),cert.slice(0,-1),Uint8Array.from([0x30,0x81,0x01,...cert.slice(2)]),Uint8Array.from(cert)];
 const unknown=examples.at(-1);const starts=[];for(let at=0;(at=Buffer.from(unknown).indexOf(Buffer.from(rsaOid),at))>=0;at++)starts.push(at);unknown[starts.at(-2)]=0x2b;
 for(const bytes of examples){const api=subtle();await assert.rejects(importOriginalReleaseSigner(Buffer.from(bytes).toString('base64'),{subtle:api}));assert.equal(api.calls.length,1);}
});
test('requires digest and import support and no key or pin bypass options',async()=>{
 const {cert}=certificate(),bad=subtle({valid:false});await assert.rejects(importOriginalReleaseSigner(Buffer.from(cert).toString('base64'),{subtle:bad,pin:'00'}));
 await assert.rejects(importOriginalReleaseSigner(Buffer.from(cert).toString('base64'),{subtle:{}}));
});
