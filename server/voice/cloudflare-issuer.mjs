// The already approved backend supplies its non-extractable Ed25519 signing key.
// This factory never generates, exports, stores, discovers or logs a credential/key.
const identifier=/^[A-Za-z0-9_-]{1,128}$/;
const originPattern=/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function createCloudflareIssuer({key,issuer,kid,origin,authVersion=1,clock=Date.now,subtle=globalThis.crypto?.subtle,randomId=()=>crypto.randomUUID(),controllerAuthTtlSeconds=60,enabled=false}={}) {
 if(!subtle||typeof clock!=='function'||typeof randomId!=='function'||!Number.isSafeInteger(authVersion)||authVersion<1||!Number.isInteger(controllerAuthTtlSeconds)||controllerAuthTtlSeconds<16||controllerAuthTtlSeconds>300)throw TypeError('Private issuer dependencies required');
 const configured=()=>enabled===true&&key?.type==='private'&&key.extractable===false&&key.algorithm?.name==='Ed25519'&&
  key.usages?.includes('sign')&&typeof issuer==='string'&&issuer.length>0&&issuer.length<=256&&
  typeof kid==='string'&&identifier.test(kid)&&originPattern.test(origin??'');
 async function mintCredential(plan,{identity,role},{signal}={}) {
  if(!configured()||signal?.aborted||plan?.provider!=='navrang-relay-v1'||plan.origin!==origin||
    !/^nr_[a-f0-9]{32}$/.test(plan.roomId??'')||!identifier.test(identity??'')||!['controller','speaker','listener'].includes(role)||
    (role==='speaker'&&identity!==plan.publisherIdentity)||!Number.isSafeInteger(plan.generation)||plan.generation<1)
   throw Error('Issuer unavailable');
  const now=clock(),deadline=Date.parse(plan.expiresAt);
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(deadline)||deadline%1000!==0||deadline<1||(role!=='controller'&&deadline<=now)||deadline>now+15000)throw Error('Issuer unavailable');
  const jti=randomId();if(!identifier.test(jti))throw Error('Issuer unavailable');
  // The server-only controller must remain authenticated to inspect/revoke an
  // expired media lease. This never extends the immutable media deadline or
  // speaker/listener authorization, and remains within the relay's300s ceiling.
  const issuedAt=Math.floor(now/1000),authorizationExpiry=role==='controller'?issuedAt+controllerAuthTtlSeconds:deadline/1000;
  const claims={iss:issuer,aud:'navrang-relay-v1',room:plan.roomId,sub:identity,role,authVersion,
   jti,iat:issuedAt,exp:authorizationExpiry};
  const unsigned=encode({alg:'EdDSA',typ:'JWT',kid})+'.'+encode(claims);
  const signature=await subtle.sign('Ed25519',key,new TextEncoder().encode(unsigned));
  if(signal?.aborted||clock()>=authorizationExpiry*1000)throw Error('Issuer unavailable');
  return {credential:{provider:'navrang-relay-v1',origin,roomId:plan.roomId,leaseId:plan.leaseId,
   generation:plan.generation,identity,role,expiresAt:plan.expiresAt,...(role==='controller'?{authorizationExpiresAt:new Date(authorizationExpiry*1000).toISOString()}:{}),token:unsigned+'.'+Buffer.from(signature).toString('base64url')}};
 }
 return Object.freeze({configured,mintCredential,mintControllerCredential:(plan,principal,options)=>mintCredential(plan,{...principal,role:'controller'},options)});
}
