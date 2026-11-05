-- Disposable SQL state preparation tests; real voice transport remains NOT_RUN.
do $test$
declare
 admin_token text:=repeat('a',64); scanner_token text:=repeat('b',64); other_token text:=repeat('c',64);
 scanner_id uuid:=gen_random_uuid();other_id uuid:=gen_random_uuid();
 a jsonb;b jsonb;c jsonb;duty uuid;channel uuid;operation uuid;generation bigint;lease uuid;entry text;command jsonb;private_session uuid;other_duty uuid;
begin
 if to_regprocedure('navrang_private.voice_rpc(text,jsonb,text)') is null then raise exception 'Voice state helper missing';end if;
 insert into navrang_private.sessions(hash,role,expires_at) values(admin_token,'admin',clock_timestamp()+interval '1 hour');
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station)
 values(scanner_id,'Voice fixture scanner','code',true,true,true,'checker'),(other_id,'Voice fixture other','code',true,true,true,'checker');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(scanner_token,'checker',scanner_id,clock_timestamp()+interval '1 hour'),(other_token,'checker',other_id,clock_timestamp()+interval '1 hour');
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"test-scanner"}',scanner_token);
 if a->>'status'<>'503' then raise exception 'Unconfigured voice did not fail closed: %',a;end if;
 update navrang_private.voice_runtime set configured=true,revocation_verified=true,revocation_mode='cloud-explicit-cutoff',worker_at=clock_timestamp();
 if navrang_private.voice_ready() then raise exception 'Fresh worker bypassed independent media expiry verification';end if;
 update navrang_private.voice_runtime set lease_enforced=true;
 if navrang_private.voice_ready() then raise exception 'Relay lease flag bypassed controller-death verification';end if;
 -- Synthetic state fixture only. These flags are never enabled by application
 -- code and do not establish any real transport or controller-death evidence.
 update navrang_private.voice_runtime set worker_death_verified=true;
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"test-scanner"}',scanner_token);duty:=(a->>'dutyId')::uuid;channel:=(a->>'sessionId')::uuid;
 if duty is null or channel is null then raise exception 'Duty join failed: %',a;end if;
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',duty,'sessionId',channel),scanner_token);
 if a->>'canPublish'<>'false' or a ? 'token' then raise exception 'Join must prepare subscribe-only membership, not mint token: %',a;end if;
 a:=navrang_private.voice_rpc('floor-prepare',jsonb_build_object('sessionId',channel,'requestId',gen_random_uuid()),scanner_token);
 operation:=(a->>'operationId')::uuid;generation:=(a->>'generation')::bigint;lease:=(a->>'leaseId')::uuid;
 if operation is null or a->>'state'<>'granting' then raise exception 'Floor preparation failed: %',a;end if;
 b:=navrang_private.voice_rpc('duty-join','{"installationId":"test-admin"}',admin_token);
 b:=navrang_private.voice_rpc('voice-broadcast-start',jsonb_build_object('requestId',gen_random_uuid(),'audience','{"type":"everyone"}'::jsonb),admin_token);
 if b->>'status'<>'409' or exists(select 1 from navrang_private.voice_sessions where kind='broadcast') then
  raise exception 'In-flight grant was preempted or a failed broadcast left an orphan room: %',b;
 end if;
 b:=navrang_private.voice_rpc('floor-commit',jsonb_build_object('operationId',operation,'generation',generation),scanner_token);
 if b->>'state'<>'active' then raise exception 'Acknowledged floor did not commit: %',b;end if;
 b:=navrang_private.voice_rpc('duty-join','{"installationId":"test-other"}',other_token);other_duty:=(b->>'dutyId')::uuid;
 b:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',other_duty,'sessionId',channel),other_token);
 b:=navrang_private.voice_rpc('floor-prepare',jsonb_build_object('sessionId',channel,'requestId',gen_random_uuid()),other_token);
 if b->>'status'<>'409' then raise exception 'Ordinary speaker stole held floor: %',b;end if;
 b:=navrang_private.voice_rpc('voice-invite',jsonb_build_object('requestId',gen_random_uuid(),'staffId',other_id),admin_token);private_session:=(b->>'sessionId')::uuid;
 if private_session is null or private_session=channel then raise exception 'Private call did not create an isolated room';end if;
 c:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',duty,'sessionId',private_session),scanner_token);
 if c->>'status'<>'403' then raise exception 'Uninvited scanner joined private call';end if;
 c:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',other_duty,'sessionId',private_session),other_token);
 if c->>'canPublish'<>'false' then raise exception 'Invited private call listener unavailable or automatically transmitting';end if;
 b:=navrang_private.voice_rpc('voice-broadcast-start',jsonb_build_object('requestId',gen_random_uuid(),'audience',jsonb_build_object('type','staff','staffIds',jsonb_build_array(scanner_id))),scanner_token);
 if b->>'status'<>'403' then raise exception 'Staff created admin broadcast';end if;
 b:=navrang_private.voice_rpc('duty-join','{"installationId":"test-admin"}',admin_token);
 b:=navrang_private.voice_rpc('voice-broadcast-start',jsonb_build_object('requestId',gen_random_uuid(),'audience',jsonb_build_object('type','staff','staffIds',jsonb_build_array(scanner_id))),admin_token);
 if b->>'sessionId'=channel::text or jsonb_array_length(b->'revoke')<>1 then raise exception 'Broadcast must isolate room and revoke old floor first: %',b;end if;
 c:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',(select id from navrang_private.voice_duty where session_hash=other_token),'sessionId',b->>'sessionId'),other_token);
 if c->>'status'<>'403' then raise exception 'Unintended broadcast subscriber admitted: %',c;end if;
 c:=navrang_private.voice_rpc('floor-commit',jsonb_build_object('operationId',operation,'generation',generation),scanner_token);
 if c->>'status'<>'409' then raise exception 'Delayed old grant restored preempted floor: %',c;end if;
 update navrang_private.voice_runtime set worker_at=clock_timestamp()-interval '4 seconds';
 c:=navrang_private.voice_rpc('voice-renew',jsonb_build_object('sessionId',channel,'leaseId',lease),scanner_token);
 if c->>'status'<>'503' then raise exception 'Stale worker allowed renewal: %',c;end if;
 update navrang_private.voice_runtime set worker_at=clock_timestamp();
 update navrang_private.checkers set active=false where id=scanner_id;
 c:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',duty,'sessionId',channel),scanner_token);
 if c->>'status'<>'403' then raise exception 'Revoked staff joined room';end if;
 -- Expired leases must queue removal without a request from the lost sender.
 update navrang_private.voice_floors set expires_at=clock_timestamp()-interval '1 second' where phase='granting';
 -- Deleting the bearer at logout must succeed and preserve removal identities.
 delete from navrang_private.sessions where hash=other_token;
 c:=navrang_private.voice_expire();
 if not exists(select 1 from jsonb_array_elements(c->'commands') item where item->>'identity'=(select identity::text from navrang_private.voice_members where duty_id=duty and session_id=channel)) then
  raise exception 'Revoked receive-only or old speaker identity did not queue relay removal';
 end if;
 -- The worker can acknowledge removals without requiring the revoked bearer.
 for command in select value from jsonb_array_elements(c->'commands') loop
  a:=navrang_private.voice_ack_revoke((command->>'commandId')::uuid,(command->>'generation')::bigint);
  if a->>'state'<>'acked' then raise exception 'Worker could not acknowledge durable removal: %',a;end if;
 end loop;
 if exists(select 1 from navrang_private.voice_floors where phase='active') then raise exception 'Expired/revoked floor stayed active';end if;
 if exists(select 1 from navrang_private.voice_members members join navrang_private.voice_duty duty on duty.id=members.duty_id where duty.session_hash=other_token) then raise exception 'Logged-out listening membership retained after relay removal';end if;
 if exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state<>'ended') then raise exception 'Expired broadcast did not finish after relay acknowledgements';end if;
 if navrang_private.voice_ready() then raise exception 'Expired in-flight grant was not quarantined for transport reconciliation';end if;
 foreach entry in array array['voice_runtime','voice_duty','voice_sessions','voice_members','voice_floors','voice_commands'] loop
  if not (select relrowsecurity from pg_class where oid=('navrang_private.'||entry)::regclass) then raise exception 'Voice table lacks RLS: %',entry;end if;
  if has_table_privilege('anon','navrang_private.'||entry,'SELECT') or has_table_privilege('authenticated','navrang_private.'||entry,'SELECT') then raise exception 'Voice table publicly readable: %',entry;end if;
 end loop;
 if has_function_privilege('anon','navrang_private.voice_rpc(text,jsonb,text)','EXECUTE') or has_function_privilege('authenticated','navrang_private.voice_rpc(text,jsonb,text)','EXECUTE') then raise exception 'Voice helper exposed';end if;
end;
$test$;

-- Internal controller coverage, using the existing fixture connection only.
-- No role switch, endpoint or privilege mutation is needed for these checks.
do $controller_test$
declare
 first_owner uuid:=gen_random_uuid();next_owner uuid:=gen_random_uuid();
 session_id uuid;command_id uuid:=gen_random_uuid();result jsonb;unprivileged text;
begin
 if to_regprocedure('public.navrang_voice_controller(text,jsonb)') is not null then raise exception 'Unexpected public controller endpoint';end if;
 foreach unprivileged in array array['anon','authenticated'] loop
  -- PostgreSQL rejects execution before entering the private function because
  -- neither role has EXECUTE. Also verify the in-body role guard rejects them.
  if has_function_privilege(unprivileged,'navrang_private.voice_rpc(text,jsonb,text)','EXECUTE') or
     pg_catalog.pg_has_role(unprivileged,'service_role','USAGE') then
   raise exception 'Unprivileged controller execution allowed: %',unprivileged;
  end if;
 end loop;
 result:=public.navrang_communications('controller-claim',jsonb_build_object('controllerId',first_owner),'');
 if result->>'status'<>'400' then raise exception 'Internal action exposed through app router: %',result;end if;
 result:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',first_owner),repeat('a',64));
 if result->>'status'<>'403' then raise exception 'App bearer entered controller path: %',result;end if;
 result:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',first_owner),null);
 if result->>'status'<>'403' then raise exception 'Null bearer entered controller path: %',result;end if;
 result:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',first_owner),'');
 if result->>'claimed'<>'true' then raise exception 'Controller claim failed: %',result;end if;
 result:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',next_owner),'');
 if result->>'status'<>'409' then raise exception 'Second live controller acquired ownership';end if;
 update navrang_private.voice_runtime set configured=true,revocation_verified=true,revocation_mode='cloud-explicit-cutoff',
  lease_enforced=false,worker_death_verified=false,worker_at=clock_timestamp();
 result:=navrang_private.voice_rpc('controller-heartbeat',jsonb_build_object('controllerId',first_owner),'');
 if result->>'observed'<>'true' or navrang_private.voice_ready() or
    exists(select 1 from navrang_private.voice_runtime where worker_at is not null or controller_at is null) then
  raise exception 'Controller liveness bypassed independent media gates: %',result;
 end if;
 result:=navrang_private.voice_rpc('controller-heartbeat',jsonb_build_object('controllerId',first_owner,'leaseEnforced',true),'');
 if result->>'status'<>'400' or exists(select 1 from navrang_private.voice_runtime where lease_enforced) then
  raise exception 'Controller payload could set transport acceptance';
 end if;
 insert into navrang_private.voice_sessions(kind,owner_principal,audience) values('private','controller-fixture','{}') returning id into session_id;
 insert into navrang_private.voice_floors(session_id) values(session_id);
 insert into navrang_private.voice_commands(id,operation_id,session_id,room,identity,generation,operation)
 select command_id,gen_random_uuid(),session_id,room,gen_random_uuid(),7,'revoke' from navrang_private.voice_sessions where id=session_id;
 result:=navrang_private.voice_rpc('controller-poll',jsonb_build_object('controllerId',first_owner),'');
 if not exists(select 1 from jsonb_array_elements(result->'commands') item where item->>'commandId'=command_id::text) then
  raise exception 'Durable removal missing from controller poll: %',result;
 end if;
 update navrang_private.voice_runtime set controller_until=clock_timestamp()-interval '1 second';
 result:=navrang_private.voice_rpc('controller-ack',jsonb_build_object('controllerId',first_owner,'commandId',command_id,'generation',7),'');
 if result->>'status'<>'409' or (select state from navrang_private.voice_commands where id=command_id)<>'pending' then raise exception 'Expired owner acknowledged removal';end if;
 result:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',next_owner),'');
 if result->>'claimed'<>'true' then raise exception 'Expired ownership did not allow takeover';end if;
 result:=navrang_private.voice_rpc('controller-release',jsonb_build_object('controllerId',first_owner),'');
 if result->>'status'<>'409' or (select controller_id from navrang_private.voice_runtime)<>next_owner then raise exception 'Stale owner released successor';end if;
 result:=navrang_private.voice_rpc('controller-ack',jsonb_build_object('controllerId',first_owner,'commandId',command_id,'generation',7),'');
 if result->>'status'<>'409' then raise exception 'Stale owner acknowledged after takeover';end if;
 result:=navrang_private.voice_rpc('controller-ack',jsonb_build_object('controllerId',next_owner,'commandId',command_id,'generation',6),'');
 if result->>'status'<>'409' then raise exception 'Incorrect generation acknowledged';end if;
 result:=navrang_private.voice_rpc('controller-ack',jsonb_build_object('controllerId',next_owner,'commandId',command_id,'generation',7),'');
 if result->>'state'<>'acked' then raise exception 'Current controller could not acknowledge removal: %',result;end if;
 result:=navrang_private.voice_rpc('controller-release',jsonb_build_object('controllerId',next_owner),'');
 if result->>'released'<>'true' or exists(select 1 from navrang_private.voice_runtime where controller_id is not null or controller_until is not null or worker_at is not null) then
  raise exception 'Graceful release retained ownership or healthy-worker claim';
 end if;
end;
$controller_test$;
