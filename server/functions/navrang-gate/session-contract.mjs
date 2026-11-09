const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const device=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const exact=(p,keys)=>Object.keys(p).every(key=>keys.includes(key));
export function validateSessionRequest(action,p){
 if(action==='session-refresh'){
  if(!exact(p,['refreshToken','nextRefreshHash','requestId','installationId'])||!hex(p.refreshToken)||!hex(p.nextRefreshHash)||!uuid(p.requestId)||!device(p.installationId))throw Error('Invalid session renewal.');
 }else if(action==='logout'&&p.refreshToken!==undefined){
  if(!exact(p,['refreshToken','installationId'])||!hex(p.refreshToken)||!device(p.installationId))throw Error('Invalid session revocation.');
 }else if(['login','checker-login','google-login'].includes(action)&&(p.authProtocol!==undefined||p.installationId!==undefined)){
  const fields=action==='login'?['username','password']:action==='checker-login'?['code']:['accessToken'];
  if(p.authProtocol!==1||!device(p.installationId)||!exact(p,[...fields,'authProtocol','installationId']))throw Error('Invalid session protocol.');
 }
 return p;
}
