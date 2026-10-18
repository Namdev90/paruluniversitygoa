// This module validates shape only. The database resolves every recipient and
// permission from the current Navrang session; a valid payload grants no access.
export const COMMUNICATION_ACTIONS = Object.freeze([
  'notifications-feed','notifications-read','notifications-dashboard',
  'notifications-preview','notifications-send','notifications-end',
  'notifications-device','notifications-unregister',
  'duty-join','duty-heartbeat','duty-leave',
  'voice-join','voice-floor','voice-renew','voice-release',
  'voice-broadcast-start','voice-broadcast-end','voice-invite',
]);
export const TEMPLATE_TYPES = Object.freeze([
  'announcement','emergency','meeting','call-request','update','live-broadcast',
]);
export const AUDIENCE_ROLES = Object.freeze(['administrator','checker','faculty','helpdesk']);
export const URGENCIES = Object.freeze(['normal','urgent','emergency']);
export const COMMUNICATION_LIMITS = Object.freeze({
  payloadBytes:8192,title:100,body:1000,meetingLocation:120,
  selectedStaff:100,installationId:128,fid:256,legacyToken:4096,
});

const actions = new Set(COMMUNICATION_ACTIONS);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprint = /^[a-f0-9]{64}$/;
const invalid = label => { throw Error('Invalid '+label+'.'); };

export function isCommunicationAction(action) {
  return typeof action === 'string' && actions.has(action);
}

function object(value,allowed,required,label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(label+' field');
  if (required.some(key => !own(value,key))) invalid(label);
  return value;
}

function id(value,label) {
  if (typeof value !== 'string' || !uuid.test(value)) invalid(label);
  return value.toLowerCase();
}

function proof(value,label) {
  if (typeof value !== 'string' || !fingerprint.test(value)) invalid(label);
  return value;
}

function installation(value) {
  if (typeof value !== 'string' || value.length > COMMUNICATION_LIMITS.installationId ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) invalid('installation identifier');
  return value;
}

function text(value,label,maximum,{empty=false,multiline=false}={}) {
  if (typeof value !== 'string' || value.length > maximum) invalid(label);
  const cleaned = value.replace(/\r\n?/g,'\n').trim();
  if ((!empty && !cleaned) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned) ||
      (!multiline && /[\r\n\t]/.test(cleaned))) invalid(label);
  // Only plain content belongs here. Destinations come from server-owned event
  // types, never HTML, uploads, or a URL provided in the announcement payload.
  if (/<\s*(?:\/?\s*[A-Za-z]|[!?])[^>]*(?:>|$)/.test(cleaned) ||
      /(?:\b(?:https?|ftp|file|javascript|data|intent|tel|sms|mailto):|\bwww\.)/i.test(cleaned)) invalid(label);
  return cleaned;
}

function isoTime(value) {
  if (typeof value !== 'string') invalid('meeting time');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) invalid('meeting time');
  const [year,month,day,hour,minute,second] = parts.slice(1,7).map(Number);
  const local = new Date(0);
  local.setUTCFullYear(year,month-1,day);
  local.setUTCHours(hour,minute,second,0);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month-1 ||
      local.getUTCDate() !== day || local.getUTCHours() !== hour ||
      local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) invalid('meeting time');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid('meeting time');
  return new Date(timestamp).toISOString();
}

function template(value) {
  object(value,['type','title','body','urgency','meetingLocation','meetingTime'],['type','title'],'notification template');
  if (!TEMPLATE_TYPES.includes(value.type)) invalid('notification template type');
  const urgency = own(value,'urgency') ? value.urgency : value.type === 'emergency' ? 'emergency' : 'normal';
  if (!URGENCIES.includes(urgency) || (value.type === 'emergency' && urgency !== 'emergency')) invalid('notification urgency');
  const result = {
    type:value.type,
    title:text(value.title,'notification title',COMMUNICATION_LIMITS.title),
    body:text(own(value,'body') ? value.body : '','notification body',COMMUNICATION_LIMITS.body,{empty:true,multiline:true}),
    urgency,
  };
  if (own(value,'meetingLocation') || own(value,'meetingTime')) {
    if (value.type !== 'meeting') invalid('meeting fields');
    if (own(value,'meetingLocation')) result.meetingLocation = text(value.meetingLocation,'meeting location',COMMUNICATION_LIMITS.meetingLocation);
    if (own(value,'meetingTime')) result.meetingTime = isoTime(value.meetingTime);
  }
  return result;
}

function audience(value) {
  object(value,['type','roles','staffIds'],['type'],'notification audience');
  if (value.type === 'everyone') {
    object(value,['type'],['type'],'notification audience');
    return {type:'everyone'};
  }
  if (value.type === 'roles') {
    object(value,['type','roles'],['type','roles'],'notification audience');
    if (!Array.isArray(value.roles) || !value.roles.length || value.roles.length > AUDIENCE_ROLES.length ||
        value.roles.some(role => !AUDIENCE_ROLES.includes(role))) invalid('audience roles');
    return {type:'roles',roles:[...new Set(value.roles)].sort()};
  }
  if (value.type === 'staff') {
    object(value,['type','staffIds'],['type','staffIds'],'notification audience');
    if (!Array.isArray(value.staffIds) || !value.staffIds.length || value.staffIds.length > COMMUNICATION_LIMITS.selectedStaff) invalid('selected staff');
    return {type:'staff',staffIds:[...new Set(value.staffIds.map(value => id(value,'selected staff identifier')))].sort()};
  }
  invalid('notification audience type');
}

function target(value) {
  object(value,['type','value'],['type','value'],'notification provider target');
  if (!['fid','legacyToken'].includes(value.type) || typeof value.value !== 'string' ||
      value.value.length > COMMUNICATION_LIMITS[value.type] || !/^[A-Za-z0-9:_=-]+$/.test(value.value)) invalid('notification provider target');
  return {type:value.type,value:value.value};
}

/** Return a fresh canonical payload; does not authenticate or resolve a role. */
export function validateCommunication(action,payload) {
  if (!isCommunicationAction(action)) invalid('communication action');
  object(payload,Object.keys(payload ?? {}),[],'communication payload');
  let encoded;
  try { encoded = JSON.stringify(payload); }
  catch { invalid('communication payload'); }
  if (new TextEncoder().encode(encoded).length > COMMUNICATION_LIMITS.payloadBytes) invalid('communication payload size');

  const shape = (allowed,required=allowed) => object(payload,allowed,required,'communication payload');
  switch (action) {
    case 'notifications-feed': {
      shape(['afterRevision'],[]);
      const afterRevision = own(payload,'afterRevision') ? payload.afterRevision : 0;
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) invalid('notification revision');
      return {afterRevision};
    }
    case 'notifications-read':
    case 'notifications-end':
      shape(['id']);
      return {id:id(payload.id,'notification identifier')};
    case 'notifications-dashboard':
      shape(['hidden']);
      if (typeof payload.hidden !== 'boolean') invalid('dashboard visibility');
      return {hidden:payload.hidden};
    case 'notifications-preview':
      shape(['template','audience']);
      return {template:template(payload.template),audience:audience(payload.audience)};
    case 'notifications-send':
      shape(['requestId','template','audience','previewHash']);
      return {requestId:id(payload.requestId,'request identifier'),template:template(payload.template),audience:audience(payload.audience),previewHash:proof(payload.previewHash,'preview fingerprint')};
    case 'notifications-device': {
      shape(['installationId','providerTarget','bindingId','previousUnlinkProof'],['installationId','providerTarget','bindingId']);
      const result={installationId:installation(payload.installationId),providerTarget:target(payload.providerTarget),bindingId:id(payload.bindingId,'binding identifier')};
      if (own(payload,'previousUnlinkProof')) result.previousUnlinkProof=proof(payload.previousUnlinkProof,'previous unlink proof');
      return result;
    }
    case 'notifications-unregister':
      shape(['installationId','bindingId','unlinkProof']);
      return {installationId:installation(payload.installationId),bindingId:id(payload.bindingId,'binding identifier'),unlinkProof:proof(payload.unlinkProof,'unlink proof')};
    case 'duty-join':
      shape(['installationId']);
      return {installationId:installation(payload.installationId)};
    case 'duty-heartbeat':
    case 'duty-leave':
      shape(['dutyId']);
      return {dutyId:id(payload.dutyId,'duty identifier')};
    case 'voice-join':
      shape(['dutyId','sessionId']);
      return {dutyId:id(payload.dutyId,'duty identifier'),sessionId:id(payload.sessionId,'voice session identifier')};
    case 'voice-floor':
      shape(['sessionId','requestId']);
      return {sessionId:id(payload.sessionId,'voice session identifier'),requestId:id(payload.requestId,'request identifier')};
    case 'voice-renew':
    case 'voice-release':
      shape(['sessionId','leaseId']);
      return {sessionId:id(payload.sessionId,'voice session identifier'),leaseId:id(payload.leaseId,'floor lease identifier')};
    case 'voice-broadcast-start':
      shape(['requestId','audience','previewHash']);
      return {requestId:id(payload.requestId,'request identifier'),audience:audience(payload.audience),previewHash:proof(payload.previewHash,'preview fingerprint')};
    case 'voice-broadcast-end':
      shape(['sessionId']);
      return {sessionId:id(payload.sessionId,'voice session identifier')};
    case 'voice-invite':
      shape(['requestId','staffId','previewHash']);
      return {requestId:id(payload.requestId,'request identifier'),staffId:id(payload.staffId,'staff identifier'),previewHash:proof(payload.previewHash,'preview fingerprint')};
  }
}
