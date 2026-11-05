// Private process composition only. Imports/construction read no environment,
// discover no credentials, open no database/socket, and start no HTTP listener.
import { createCloudflareVoiceStore, createCloudflareVoiceControllerStore } from './voice-store.mjs';
import { createCloudflareVoiceService } from '../voice/cloudflare-service.mjs';
import { createCloudflareConnector } from '../voice/cloudflare-connector.mjs';
import { createCloudflareController } from '../voice/cloudflare-controller.mjs';
import { createVoiceController } from '../voice/controller.mjs';

/** The deployment supplies its existing authorized pool, configured issuer and
 * authenticated HTTPS/WSS connector. Pool ownership remains with that caller.
 * Keep this instance persistent: service phases and durable cleanup share the
 * exact controller connection/receipt cache; constructing one per Edge request
 * cannot safely recover a staged operation and is intentionally unsupported.
 */
export function createCloudflareVoiceRuntime({ pool, issuer, connector, WebSocket, fetchImpl, origin, controllerIdentity, controllerId,
 enabled = false, qualification = {}, clock = Date.now, storeOptions, serviceOptions = {}, relayOptions = {}, cleanupOptions = {} } = {}) {
 const store = createCloudflareVoiceStore(pool, storeOptions);
 const cleanupStore = createCloudflareVoiceControllerStore(pool, storeOptions);
 // Explicit fields follow tuning options so a caller cannot override ownership,
 // authorization dependencies or opt-in via a nested options object.
 const transport = connector ?? (WebSocket ? createCloudflareConnector({origin,WebSocket,fetchImpl}) : undefined);
 const relay = createCloudflareController({ ...relayOptions, issuer, connector:transport, origin, controllerIdentity, enabled, qualification, clock });
 const privateService = createCloudflareVoiceService({ ...serviceOptions, rpc: store.rpc, relay, issuer, origin, clock });
 const cleanup = createVoiceController({ ...cleanupOptions, store: cleanupStore, relay, controllerId });
 const shutdown = new AbortController(); let closed = false, running = false;
 const service = Object.freeze({
  supports: privateService.supports,
  handle(...args) {
   if (closed) return Promise.resolve({ error: 'Voice is unavailable. Rejoin when communications are ready.', status: 503 });
   const options = args[3] ?? {};
   const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
   return privateService.handle(args[0], args[1], args[2], { ...options, signal });
  },
  transportEvidence: 'NOT_RUN',
 });
 async function run({ signal, onCycle = () => {} } = {}) {
  if (!signal || typeof signal.addEventListener !== 'function') throw TypeError('Explicit runtime shutdown signal required.');
  if (closed) throw Error('Relay runtime closed.');
  if (running) throw Error('Relay runtime already running.');
  running = true;
  try { await cleanup.run({ signal: AbortSignal.any([signal, shutdown.signal]), onCycle }); }
  finally { running = false; close(); }
 }
 function close() {
  if (closed) return;
  closed = true; shutdown.abort(); relay.close();
 }
 const controller = Object.freeze({
  controllerId: cleanup.controllerId, transportEvidence: 'NOT_RUN', run,
  cycle(options = {}) {
   if (closed) return Promise.resolve({ state: 'STOPPED', acked: 0 });
   const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
   return cleanup.cycle({ ...options, signal });
  },
 });
 return Object.freeze({ service, controller, relay, run, close,
  readiness: options => relay.readiness(options), transportEvidence: 'NOT_RUN' });
}
