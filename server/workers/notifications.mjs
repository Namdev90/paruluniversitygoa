// Standalone long-running worker, not a per-second Edge invocation. No listener
// or public endpoint is opened. Provisioning/deployment remains a separate gate.
import {Pool} from 'pg';
import {createDeliveryWorker} from '../functions/navrang-gate/communications.mjs';
import {createFcmTransport} from '../functions/navrang-gate/fcm-transport.mjs';
import {createMetadataTokenProvider,createNotificationStore,runNotificationLoop} from './notification-store.mjs';

if (process.env.NAVRANG_NOTIFICATION_WORKER !== 'enabled' || process.env.NAVRANG_WORKLOAD_IDENTITY !== 'google-compute' ||
    !process.env.NAVRANG_WORKER_DATABASE_URL || !process.env.NAVRANG_FCM_PROJECT_ID) {
  console.error('NOT_RUN: approved database, Google Compute workload identity and owned FCM project are required.');
  process.exitCode=2;
} else {
  const stop=new AbortController();
  process.once('SIGINT',()=>stop.abort()); process.once('SIGTERM',()=>stop.abort());
  const pool=new Pool({connectionString:process.env.NAVRANG_WORKER_DATABASE_URL,max:2,
    connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:8000,query_timeout:8000,
    application_name:'navrang-notification-worker'});
  pool.on('error',()=>console.error('Notification database connection unavailable.'));
  try {
    const worker=createDeliveryWorker({store:createNotificationStore(pool),push:createFcmTransport({
      projectId:process.env.NAVRANG_FCM_PROJECT_ID,accessToken:createMetadataTokenProvider(),
    })});
    await runNotificationLoop({worker,signal:stop.signal,onResult:result=>console.log(JSON.stringify(result))});
  } catch {console.error('Notification worker unavailable.');process.exitCode=1;}
  finally {await pool.end();}
}
