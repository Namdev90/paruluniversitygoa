import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {createVoiceController} from '../voice/controller.mjs';
import {createVoiceControllerStore} from './voice-store.mjs';
import {createLiveKitCloudRelay} from '../voice/livekit-relay.mjs';

// Persistent cleanup only. Uses the worker package's pinned PostgreSQL driver;
// no public listener is opened and no app bearer or relay grant is created.
export async function runVoiceController({env=process.env,signal,report=record=>process.stdout.write(JSON.stringify(record)+'\n')}={}) {
 if(env.NAVRANG_VOICE_CONTROLLER!=='enabled'||!env.NAVRANG_WORKER_DATABASE_URL||!signal)throw Error('Private controller configuration required.');
 const relay=createLiveKitCloudRelay({url:env.LIVEKIT_URL,apiKey:env.LIVEKIT_API_KEY,apiSecret:env.LIVEKIT_API_SECRET});
 const pool=new Pool({connectionString:env.NAVRANG_WORKER_DATABASE_URL,max:1,
  connectionTimeoutMillis:1000,idleTimeoutMillis:30000,statement_timeout:1000,query_timeout:1200,
  application_name:'navrang-voice-controller'});
 pool.on('error',()=>report({state:'DATABASE_UNAVAILABLE',acked:0}));
 try {
  const controller=createVoiceController({store:createVoiceControllerStore(pool),relay});
  let previous;
  await controller.run({signal,onCycle:record=>{
   if(record.state!==previous||record.acked>0){report(record);previous=record.state;}
  }});
 }finally{await pool.end();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const shutdown=new AbortController();
 const stop=()=>shutdown.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await runVoiceController({signal:shutdown.signal});}
 catch{process.stderr.write('Voice controller cannot start. Check private configuration and existing database access.\n');process.exitCode=78;}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
