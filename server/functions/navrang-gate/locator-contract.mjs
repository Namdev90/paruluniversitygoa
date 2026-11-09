// Only request/consent identifiers cross notification transports. Coordinates
// belong exclusively in this authenticated, event-scoped request contract.
export const LOCATOR_EVENT='O9KL3';
export const LOCATOR_ACTIONS=Object.freeze(['locator-status','locator-consent','locator-duty','locator-stop','locator-roster','locator-view','locator-request','locator-inbox','locator-respond','locator-found','locator-fix']);
const actions=new Set(LOCATOR_ACTIONS);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isLocatorAction=action=>typeof action==='string'&&actions.has(action);
const invalid=()=>{throw Error('Invalid locator request.');};
export function validateLocator(action,payload){
 if(!isLocatorAction(action)||!payload||typeof payload!=='object'||Array.isArray(payload)||![Object.prototype,null].includes(Object.getPrototypeOf(payload)))invalid();
 const fields={
  'locator-status':[], 'locator-roster':[], 'locator-inbox':[], 'locator-view':['volunteerId'],
  'locator-consent':['requestId','disclosureVersion','location','findMe'],
  'locator-duty':['requestId','durationMinutes'], 'locator-stop':['requestId'],
  'locator-request':['requestId','volunteerId'], 'locator-respond':['requestId','choice'], 'locator-found':['requestId'],
  'locator-fix':['sampleId','requestId','latitude','longitude','accuracy','capturedAt'],
 }[action];
 const allowed=['eventId',...fields];
 if(Object.keys(payload).some(key=>!allowed.includes(key))||payload.eventId!==LOCATOR_EVENT||JSON.stringify(payload).length>2048)invalid();
 const result={eventId:LOCATOR_EVENT};
 for(const field of fields){
  if(field==='requestId'&&action==='locator-fix'&&!Object.hasOwn(payload,field))continue;
  const value=payload[field];
  if(['requestId','volunteerId','sampleId'].includes(field)){if(typeof value!=='string'||!uuid.test(value))invalid();result[field]=value.toLowerCase();}
  else result[field]=value;
 }
 if(action==='locator-consent'&&(result.disclosureVersion!==1||typeof result.location!=='boolean'||typeof result.findMe!=='boolean'))invalid();
 if(action==='locator-duty'&&(!Number.isSafeInteger(result.durationMinutes)||result.durationMinutes<1||result.durationMinutes>60))invalid();
 if(action==='locator-respond'&&!['acknowledged','declined','sound','bright'].includes(result.choice))invalid();
 if(action==='locator-fix'){
  for(const [field,min,max] of [['latitude',-90,90],['longitude',-180,180],['accuracy',0,5000]])if(typeof result[field]!=='number'||!Number.isFinite(result[field])||result[field]<min||result[field]>max)invalid();
  const time=result.capturedAt;
  if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(time)||!Number.isFinite(Date.parse(time)))invalid();
  const iso=new Date(time).toISOString();if(iso.slice(0,19)!==time.slice(0,19))invalid();result.capturedAt=iso;
 }
 return result;
}
