// SPDX-License-Identifier: MIT
import { LIMIT, identifier, parseFrame } from './protocol.mjs';

// Synchronous storage and handlers: no async authorization/send race. Only metadata is persisted.
export class RelayCore {
  constructor(store, peers, clock = Date.now, uuid = () => crypto.randomUUID()) {
    this.store = store; this.peers = peers; this.clock = clock; this.uuid = uuid;
    this.storageUncertain=false;
    this.state = store.load() ?? { schema: 1, clock: 0, epoch: 0, grant: null, used: {}, roles: {} };
    if (this.state.schema !== 1) throw new Error('unsupported state');
    // No per-frame SQLite checkpoint is needed: any reconstructed actor retires its lease.
    // This also covers missing/older attachments. Fresh explicit grant => fresh durable epoch.
    this.retiredEpoch = Math.max(this.state.grant?.epoch ?? 0,this.state.prepared?.epoch ?? 0) || undefined;
    if (this.state.grant || this.state.prepared) {this.retireControl(this.state.grant ?? this.state.prepared);this.state.grant=null;this.state.prepared=null;this.save();}
    this.restoreClock();
  }
  restoreClock() {
    for(const p of this.peers.values()) if(Number.isSafeInteger(p.flow?.clock)) this.state.clock=Math.max(this.state.clock,p.flow.clock);
  }
  checkpoint(p) {p.flow.clock=this.state.clock;p.persist();}
  save() {
    try {this.store.save(this.state);}
    catch(failure) {this.storageUncertain=true;throw failure;}
  }
  now() {
    if(this.storageUncertain)throw Error('storage unavailable');
    const n = this.clock();
    if (!Number.isSafeInteger(n) || n < this.state.clock) throw new Error('clock rollback');
    this.state.clock = n; return n;
  }
  active(p, now = this.now()) {
    const r = this.state.roles[p.subject];
    return !this.storageUncertain && this.peers.get(p.id) === p && p.open() && p.expires > now && r?.version === p.version && r.role === p.role;
  }
  prune(n) {
    for (const [k, exp] of Object.entries(this.state.used)) if (exp <= n) delete this.state.used[k];
  }
  connect(p) {
    const n = this.now(); this.prune(n);
    if (!identifier(p.subject) || !identifier(p.jti,128) || !identifier(p.room) || !['controller','speaker','listener'].includes(p.role) || !Number.isSafeInteger(p.version) || p.version < 1 || p.expires <= n || p.expires > n + 300000) throw new Error('principal invalid');
    const key = `j:${p.jti}`, subjectKey = p.subject;
    if (Object.hasOwn(this.state.used,key) || Object.keys(this.state.used).length >= LIMIT.records) throw new Error('reconnect replay or capacity');
    const old = Object.hasOwn(this.state.roles, subjectKey) ? this.state.roles[subjectKey] : undefined;
    if (old && (p.version < old.version || (p.version === old.version && p.role !== old.role))) throw new Error('stale role');
    if (!old && Object.keys(this.state.roles).length >= LIMIT.records) throw new Error('subject capacity');
    // Persist higher authorization versions before invalidating old sockets, even if capacity denies admission.
    if (!old || p.version > old.version) {
      Object.defineProperty(this.state.roles, subjectKey, { value: {version:p.version,role:p.role}, enumerable:true, configurable:true, writable:true });
      this.save();
      for (const q of [...this.peers.values()]) if (q.subject === p.subject) this.disconnect(q, 'role changed');
    }
    for (const q of [...this.peers.values()]) if (!this.active(q,n)) this.disconnect(q,'expired');
    const others = [...this.peers.values()];
    if (others.length >= LIMIT.sockets || others.some(q => q.subject === p.subject) || (p.role !== 'listener' && others.some(q => q.role === p.role)) || (p.role === 'listener' && others.filter(q => q.role === 'listener').length >= LIMIT.listeners)) throw new Error('room capacity');
    this.state.used[key] = p.expires; this.save();
    p.flow = { outstanding: null, controlWindow: Math.floor(n/1000), controls: 0, sentBytes: 0 };
    this.checkpoint(p); this.peers.set(p.id,p);
    this.control(p,{type:'ready',role:p.role,subject:p.subject});
    // Authoritative discovery for a mid-lease listener: replay identity, never renew.
    const g=this.state.grant;
    if(p.role==='listener' && this.active(p) && this.lease(g)) {
      this.sendBounded(p,JSON.stringify(this.publicGrant(g)),()=>{const at=this.now();return this.active(p,at)&&this.lease(g,at);});
    }
  }
  // One bounded tombstone preserves exact controller-bound retirement across inspection/retry.
  retireControl(g) {
    if(g?.operationId)this.state.controlRetired={operationId:g.operationId,grantId:g.grantId,epoch:g.epoch,deadline:g.deadline,subject:g.subject,controllerId:g.controllerId,controllerSubject:g.controllerSubject,controllerVersion:g.controllerVersion,room:g.room};
  }
  controlOwner(p,g) {
    return !!g&&(g.controllerId===p.id||g.controllerSubject===p.subject&&g.room===p.room&&Number.isSafeInteger(g.controllerVersion)&&p.version>=g.controllerVersion);
  }
  discoverControl(p,m) {
    const fields=m.operationId===undefined?['type','subject','deadline']:['type','subject','deadline','operationId'];
    if(Object.keys(m).length!==fields.length||!Object.keys(m).every(k=>fields.includes(k))||!identifier(m.subject)||
     !Number.isSafeInteger(m.deadline)||m.deadline<1||m.operationId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(m.operationId))throw Error('Invalid room inspection');
    const targets=[this.state.grant,this.state.prepared,this.state.controlRetired].filter(g=>g&&g.operationId&&
     g.controllerSubject===p.subject&&g.room===p.room&&this.controlOwner(p,g)&&g.subject===m.subject&&g.deadline===m.deadline&&
     (m.operationId===undefined||g.operationId===m.operationId));
    // No absence inference and no choice between multiple distinct authority records.
    if(targets.length!==1)throw Error('Room inspection unavailable or ambiguous');
    const target=targets[0];
    return this.scopedControl(p,{type:'inspect',operationId:target.operationId,grantId:target.grantId,epoch:target.epoch,deadline:target.deadline},true);
  }
  scopedControl(p,m,discovery=false) {
    const fields=['type','operationId','grantId','epoch','deadline'];
    const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
    if(Object.keys(m).length!==fields.length||!Object.keys(m).every(k=>fields.includes(k))||!uuid(m.operationId)||!uuid(m.grantId)||
      !Number.isSafeInteger(m.epoch)||m.epoch<1||m.epoch>0xffffffff||!Number.isSafeInteger(m.deadline)||m.deadline<1)throw Error('Invalid scoped control');
    const matches=g=>this.controlOwner(p,g)&&['operationId','grantId','epoch','deadline'].every(k=>g[k]===m[k]);
    let status,target;
    if(matches(this.state.grant)){status='active';target=this.state.grant;}
    else if(matches(this.state.prepared)){status='prepared';target=this.state.prepared;}
    else if(matches(this.state.controlRetired)){status='revoked';target=this.state.controlRetired;}
    else throw Error('Unknown scoped grant');
    const expired=status==='active'?!this.lease(target):status==='prepared'?!this.preparedLive(target):false;
    if((m.type==='revoke-prepared'||expired)&&status!=='revoked'){
      this.retireControl(target);
      if(status==='active')this.state.grant=null;else this.state.prepared=null;
      this.save();
      this.notify({type:'revoked',epoch:target.epoch,reason:'controller revoked'});
      status='revoked';
    }
    const receipt={type:m.type==='inspect'?'inspected':'revoked-prepared',operationId:target.operationId,grantId:target.grantId,epoch:target.epoch,deadline:target.deadline,subject:target.subject,status};
    if(status==='revoked')receipt.forwardingStopped=true;
    if(discovery){receipt.type='room-inspected';receipt.room=target.room;receipt.controllerSubject=target.controllerSubject;}
    this.control(p,receipt);
  }
  disconnect(p, reason = 'closed') {
    const g = this.state.grant;
    if (g && (g.speakerId === p.id || g.controllerId === p.id)) { this.retireControl(g);this.state.grant = null; this.save(); this.notify({type:'revoked',epoch:g.epoch,reason}); }
    const pending = this.state.prepared;
    if (pending && (pending.speakerId === p.id || pending.controllerId === p.id)) {
      this.retireControl(pending);this.state.prepared=null;this.save();this.notify({type:'revoked',epoch:pending.epoch,reason});
    }
    this.peers.delete(p.id); p.close(1008, reason);
  }
  control(p, msg) {
    this.sendBounded(p,JSON.stringify(msg));
  }
  sendBounded(p, data, permit = () => true) {
    if(this.storageUncertain)return false;
    // Workers does not expose bufferedAmount. A lifetime send budget bounds even a lying ACK peer.
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    if (!p.open() || p.flow.sentBytes + size > 262144) {
      this.peers.delete(p.id); p.close(1008,'send budget'); return false;
    }
    p.flow.sentBytes += size; this.checkpoint(p);
    // The final check follows attachment/storage bookkeeping, which can consume time.
    if (!permit()) return false;
    p.send(data); return true;
  }
  notify(msg) {
    for (const p of [...this.peers.values()]) if (this.active(p)) this.control(p,msg);
  }
  lease(g, n = this.now()) {
    const c = g && this.peers.get(g.controllerId), s = g && this.peers.get(g.speakerId);
    return !!g && g === this.state.grant && n < g.deadline && !!c && !!s && c.role === 'controller' && s.role === 'speaker' && this.active(c,n) && this.active(s,n);
  }
  preparedLive(g, n = this.now()) {
    const c = g && this.peers.get(g.controllerId), s = g && this.peers.get(g.speakerId);
    return !!g && g === this.state.prepared && n < g.deadline && !!c && !!s && c.role === 'controller' && s.role === 'speaker' && this.active(c,n) && this.active(s,n);
  }
  preparedReceipt(g) {return {type:'prepared',operationId:g.operationId,grantId:g.grantId,epoch:g.epoch,deadline:g.deadline};}
  staged(p,m,n) {
    const keys=Object.keys(m);
    const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
    if(m.type==='prepare') {
      if(keys.length!==4||!keys.every(key=>['type','subject','operationId','deadline'].includes(key))||!identifier(m.subject)||!uuid(m.operationId)||
         !Number.isSafeInteger(m.deadline)||m.deadline<=n||m.deadline-n>LIMIT.lease)throw Error('Invalid preparation');
      const s=[...this.peers.values()].find(q=>q.subject===m.subject&&q.role==='speaker'&&this.active(q,n));
      if(!s||m.deadline>p.expires||m.deadline>s.expires||this.lease(this.state.grant,n))throw Error('Preparation authority unavailable');
      const previous=this.state.prepared;
      if(previous) {
        if(!this.preparedLive(previous,n)||previous.operationId!==m.operationId||previous.subject!==m.subject||
           previous.deadline!==m.deadline||previous.controllerId!==p.id||previous.speakerId!==s.id)throw Error('Preparation conflict');
        this.control(p,this.preparedReceipt(previous));return;
      }
      if(this.state.epoch>=0xffffffff)throw Error('Epoch exhausted');
      const g={operationId:m.operationId,grantId:this.uuid(),epoch:++this.state.epoch,subject:s.subject,deadline:m.deadline,
        controllerId:p.id,controllerSubject:p.subject,controllerVersion:p.version,room:p.room,speakerId:s.id,sequence:0,window:Math.floor(n/1000),frames:0};
      this.state.prepared=g;this.save();this.control(p,this.preparedReceipt(g));return;
    }
    if(keys.length!==5||!keys.every(key=>['type','operationId','grantId','epoch','deadline'].includes(key))||
       !uuid(m.operationId)||!uuid(m.grantId)||!Number.isSafeInteger(m.epoch)||!Number.isSafeInteger(m.deadline))throw Error('Invalid activation');
    const matches=g=>g&&g.controllerId===p.id&&g.operationId===m.operationId&&g.grantId===m.grantId&&g.epoch===m.epoch&&g.deadline===m.deadline;
    if(matches(this.state.grant)&&this.lease(this.state.grant,n)) {this.control(p,this.publicGrant(this.state.grant));return;}
    const g=this.state.prepared;
    if(!matches(g)||!this.preparedLive(g,n)||this.lease(this.state.grant,n))throw Error('Prepared grant unavailable');
    // Trusted controller sends this only after its exact private SQL commit.
    // A native speaker cannot activate or forward a prepared-but-uncommitted grant.
    this.state.prepared=null;this.state.grant=g;this.save();this.notify(this.publicGrant(g));
  }
  message(p, message) {
    const n = this.now();
    if (!this.active(p,n)) throw new Error('session unauthorized');
    if (typeof message !== 'string') return this.frame(p,message,n);
    if (message.length > 512) throw new Error('control bounds');
    const window = Math.floor(n/1000);
    if (p.flow.controlWindow !== window) { p.flow.controlWindow = window; p.flow.controls = 0; }
    if (++p.flow.controls > LIMIT.controlsPerSecond) throw new Error('control rate');
    this.checkpoint(p);
    const m = JSON.parse(message);
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('control format');
    if (m.type === 'ack' && p.role === 'listener') {
      if (!p.flow.outstanding || m.epoch !== p.flow.outstanding.epoch || m.sequence !== p.flow.outstanding.sequence) throw new Error('ack mismatch');
      p.flow.outstanding = null; this.checkpoint(p); return;
    }
    if (p.role !== 'controller') throw new Error('controller required');
    if(m.type==='inspect-room')return this.discoverControl(p,m);
    if(m.type==='revoke-prepared'||m.type==='inspect')return this.scopedControl(p,m);
    if (m.type === 'revoke') {
      const g = this.state.grant, pending=this.state.prepared; this.state.grant = null; this.state.prepared=null;this.save();
      if (g) this.notify({type:'revoked',epoch:g.epoch,reason:'controller revoked'});
      if (pending) this.notify({type:'revoked',epoch:pending.epoch,reason:'controller revoked'});
      return;
    }
    if(m.type==='prepare'||m.type==='activate')return this.staged(p,m,n);
    if (m.type !== 'grant' || !identifier(m.subject)) throw new Error('unknown control');
    if(this.state.prepared)throw Error('Prepared grant requires exact activation');
    if (this.lease(this.state.grant,n)) throw new Error('immutable active lease');
    const s = [...this.peers.values()].find(q => q.subject === m.subject && q.role === 'speaker' && this.active(q,n));
    if (!s || this.state.epoch >= 0xffffffff) throw new Error('speaker absent or epoch exhausted');
    const g = {grantId:this.uuid(),epoch:++this.state.epoch,subject:s.subject,deadline:Math.min(n+LIMIT.lease,p.expires,s.expires),controllerId:p.id,speakerId:s.id,sequence:0,window,frames:0};
    this.state.grant = g; this.save(); this.notify(this.publicGrant(g));
  }
  publicGrant(g) { return {type:'grant',grantId:g.grantId,epoch:g.epoch,subject:g.subject,deadline:g.deadline}; }
  frame(p, bytes, n) {
    const h = parseFrame(bytes), g = this.state.grant;
    if (p.role !== 'speaker' || !this.lease(g,n) || p.id !== g.speakerId || h.grantId !== g.grantId || h.epoch !== g.epoch || h.deadline !== g.deadline || h.sequence !== g.sequence+1) throw new Error('grant or sequence rejected');
    const window = Math.floor(n/1000);
    if (g.window !== window) {g.window = window; g.frames = 0;}
    if (++g.frames > LIMIT.framesPerSecond) throw new Error('frame rate');
    g.sequence = h.sequence;
    this.checkpoint(p); // Socket metadata only; reconstruction always retires this grant.
    let forwarded = 0;
    for (const q of [...this.peers.values()]) {
      // Recheck the lease/deadline/roles before EACH send, including late queued inbound frames.
      const at = this.now();
      if (!this.lease(g,at)) break;
      if (q.role !== 'listener' || !this.active(q,at) || q.flow.outstanding) continue;
      q.flow.outstanding = {epoch:g.epoch,sequence:h.sequence}; this.checkpoint(q);
      if (this.sendBounded(q,bytes,()=>{const last=this.now();return this.lease(g,last)&&this.active(q,last);})) forwarded++;
      else {q.flow.outstanding=null;this.checkpoint(q);}
    }
    return forwarded;
  }
  cleanup() {
    const n = this.now(); this.prune(n);
    for (const q of [...this.peers.values()]) if (!this.active(q,n)) this.disconnect(q,'expired');
    if (this.state.grant && !this.lease(this.state.grant,n)) {const epoch = this.state.grant.epoch; this.retireControl(this.state.grant);this.state.grant = null; this.save(); this.notify({type:'revoked',epoch,reason:'expired'});}
    if (this.state.prepared && !this.preparedLive(this.state.prepared,n)) {const epoch=this.state.prepared.epoch;this.retireControl(this.state.prepared);this.state.prepared=null;this.save();this.notify({type:'revoked',epoch,reason:'expired'});}
    this.save();
  }
}
