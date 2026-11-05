// SPDX-License-Identifier: MIT
// TEST ONLY. Never use this as a production entrypoint. Local Miniflare only.
import { DurableObject } from 'cloudflare:workers';
import { RelayCore } from '../src/core.mjs';
import { SqlMetadataStore } from '../src/storage.mjs';
export default {fetch(request,env){return env.TESTROOM.getByName('synthetic-room').fetch(request);}};
export class TestRoom extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.reconstruct();}
  reconstruct(){
    this.peers=new Map();this.sockets=new Map();this.core=new RelayCore(new SqlMetadataStore(this.ctx.storage.sql),this.peers);
    for(const ws of this.ctx.getWebSockets()){const p=this.peer(ws,ws.deserializeAttachment());this.peers.set(p.id,p);this.sockets.set(ws,p);}
    this.core.restoreClock();
  }
  peer(ws,a){
    const p={...a,open:()=>ws.readyState===1,send:x=>ws.send(x),close:(c,r)=>ws.close(c,r)};
    p.persist=()=>ws.serializeAttachment({id:p.id,room:p.room,role:p.role,subject:p.subject,jti:p.jti,version:p.version,expires:p.expires,flow:p.flow});return p;
  }
  fetch(request){
    const role=new URL(request.url).pathname.slice(1);
    if(role==='reconstruct'){this.reconstruct();return new Response('ok');}
    if(role==='status')return Response.json({sequence:this.core.state.grant?.sequence,deadline:this.core.state.grant?.deadline,outstanding:[...this.peers.values()].find(p=>p.role==='listener')?.flow.outstanding});
    if(!['controller','speaker','listener'].includes(role))return new Response('invalid',{status:400});
    const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server);
    const p=this.peer(server,{id:crypto.randomUUID(),room:'room',role,subject:role,jti:crypto.randomUUID(),version:1,expires:Date.now()+300000});
    this.sockets.set(server,p);this.core.connect(p);return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message){const p=this.sockets.get(ws);try{this.core.message(p,message);}catch{this.core.disconnect(p,'rejected');}}
  webSocketClose(ws){const p=this.sockets.get(ws);if(p)this.core.disconnect(p,'closed');this.sockets.delete(ws);}
  webSocketError(ws){this.webSocketClose(ws);}
}
