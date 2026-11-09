// SPDX-License-Identifier: MIT
import { DurableObject } from 'cloudflare:workers';
import { authenticate, AuthError } from './auth.mjs';
import { RelayCore } from './core.mjs';
import { SqlMetadataStore } from './storage.mjs';
import { routeRoom, routeRequest, websocketRequest, timeNonce, clockResponse } from './route.mjs';

export default {
  async fetch(request, env) {
    return routeRequest(request,env,{authenticate,
      forward:(room,value)=>env.ROOMS.getByName(room).fetch(value)});
  }
};

export class NavrangRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env);
    this.peers = new Map(); this.sockets = new Map();
    this.core = new RelayCore(new SqlMetadataStore(ctx.storage.sql),this.peers);
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a?.id || !a?.flow) {ws.close(1008,'invalid attachment'); continue;}
      const p = this.peer(ws,a); this.peers.set(p.id,p); this.sockets.set(ws,p);
    }
    this.core.restoreClock();
    if(this.core.retiredEpoch) this.core.notify({type:'revoked',epoch:this.core.retiredEpoch,reason:'actor reconstructed'});
  }
  peer(ws, a) {
    const p = {...a,open:()=>ws.readyState === 1,send:x=>ws.send(x),close:(c,r)=>ws.close(c,r)};
    p.persist = () => ws.serializeAttachment({id:p.id,subject:p.subject,room:p.room,role:p.role,version:p.version,jti:p.jti,expires:p.expires,flow:p.flow});
    return p;
  }
  async fetch(request) {
    const room = routeRoom(request);
    if (!room || request.method !== 'GET' || !websocketRequest(request) && (request.headers.has('Upgrade') || !timeNonce(request))) return new Response('Rejected',{status:400});
    let principal;
    try { principal = await authenticate(request,this.env,room); }
    catch (e) {return new Response('Unavailable or unauthorized',{status:e instanceof AuthError ? e.status : 503});}
    if(!websocketRequest(request))return clockResponse(this.core,request);
    const [client,server] = Object.values(new WebSocketPair());
    // The hibernation API owns the server endpoint; attachments contain metadata only.
    this.ctx.acceptWebSocket(server);
    const p = this.peer(server,{...principal,id:crypto.randomUUID()});
    this.sockets.set(server,p);
    try {
      this.core.connect(p);
      // Cleanup only: EVERY forward independently enforces authorization and absolute deadline.
      await this.ctx.storage.setAlarm(Date.now()+15000);
    } catch { this.fail(server,p); return new Response('Session rejected',{status:403}); }
    return new Response(null,{status:101,webSocket:client});
  }
  fail(ws,p) {
    try { if (p) this.core.disconnect(p,'rejected'); else ws.close(1008,'rejected'); }
    catch { ws.close(1011,'unavailable'); }
    this.sockets.delete(ws);
  }
  webSocketMessage(ws,message) {
    const p = this.sockets.get(ws);
    try {if (!p) throw new Error('unknown session'); this.core.message(p,message);}
    catch {this.fail(ws,p);}
  }
  webSocketClose(ws) {this.fail(ws,this.sockets.get(ws));}
  webSocketError(ws) {this.fail(ws,this.sockets.get(ws));}
  async alarm() {
    try {this.core.cleanup();}
    catch {for (const ws of this.ctx.getWebSockets()) this.fail(ws,this.sockets.get(ws));}
    if (this.peers.size) await this.ctx.storage.setAlarm(Date.now()+15000);
  }
}
