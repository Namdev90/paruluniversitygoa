-- Disposable transaction only. Synthetic strict receipts test state transitions,
-- never provider behavior. All fixture rows and acceptance flags are rolled back.
begin;
do $daily_test$
declare
 speaker_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 listener_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 other_listener_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 speaker_id uuid:=gen_random_uuid();listener_id uuid:=gen_random_uuid();other_listener_id uuid:=gen_random_uuid();
 speaker_duty uuid;listener_duty uuid;other_listener_duty uuid;voice_session uuid;owner_id uuid:=gen_random_uuid();
 a jsonb;b jsonb;c jsonb;first_plan jsonb;next_plan jsonb;third_plan jsonb;receipt jsonb;command jsonb;
 current_op uuid;current_gen bigint;current_lease uuid;next_op uuid;
begin
 -- Existing fixtures may deliberately leave failed grants. Isolate this test's
 -- state inside the rollback transaction without changing any production gate.
 update navrang_private.voice_commands set state='acked' where state<>'acked';
 update navrang_private.voice_floors set phase='idle',daily_plan=null;
 update navrang_private.voice_sessions set state='ended' where kind='broadcast';
 update navrang_private.voice_runtime set configured=false,revocation_verified=false,
  lease_enforced=false,worker_death_verified=false,controller_id=null,controller_until=null,worker_at=null;
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station)
 values(speaker_id,'Daily fixture speaker','code',true,true,true,'checker'),
  (listener_id,'Daily fixture listener','code',true,true,true,'checker'),
  (other_listener_id,'Daily fixture second listener','code',true,true,true,'checker');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(speaker_token,'checker',speaker_id,clock_timestamp()+interval '1 hour'),
  (listener_token,'checker',listener_id,clock_timestamp()+interval '1 hour'),
  (other_listener_token,'checker',other_listener_id,clock_timestamp()+interval '1 hour');
 a:=navrang_private.voice_rpc('daily-receive','{}',speaker_token);
 if a->>'status' is distinct from '503' then raise exception 'Unverified Daily state was enabled: %',a;end if;
 a:=public.navrang_communications('daily-plan','{}',speaker_token);
 if a->>'status' is distinct from '400' then raise exception 'Private Daily action exposed through public router: %',a;end if;
 -- Synthetic acceptance flags are local fixture inputs only.
 update navrang_private.voice_runtime set configured=true,revocation_verified=true,lease_enforced=true,
  worker_death_verified=true,revocation_mode='guarded-admission',worker_at=clock_timestamp();
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"daily-speaker-fixture"}',speaker_token);
 speaker_duty:=(a->>'dutyId')::uuid;
 if speaker_duty is null or jsonb_typeof(a->'serverTime') is distinct from 'number' or a->>'expiresAt' is null then raise exception 'Duty timing missing: %',a;end if;
 a:=navrang_private.voice_rpc('duty-heartbeat',jsonb_build_object('dutyId',speaker_duty),speaker_token);
 if a->>'expiresAt' is null or jsonb_typeof(a->'serverTime') is distinct from 'number' then raise exception 'Heartbeat timing missing: %',a;end if;
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"daily-listener-fixture"}',listener_token);
 listener_duty:=(a->>'dutyId')::uuid;
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"daily-other-listener-fixture"}',other_listener_token);
 other_listener_duty:=(a->>'dutyId')::uuid;
 insert into navrang_private.voice_sessions(kind,owner_principal,audience)
 values('private',speaker_id::text,'{"type":"everyone"}') returning id into voice_session;
 insert into navrang_private.voice_floors(session_id) values(voice_session);
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',speaker_duty,'sessionId',voice_session),speaker_token);
 if a->>'state' is distinct from 'idle' or a->'plan' is distinct from 'null'::jsonb then raise exception 'Idle discovery exposed room credentials: %',a;end if;
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',listener_duty,'sessionId',voice_session),listener_token);
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',other_listener_duty,'sessionId',voice_session),other_listener_token);
 a:=navrang_private.voice_rpc('floor-prepare',jsonb_build_object('sessionId',voice_session,'requestId',gen_random_uuid()),speaker_token);
 current_op:=(a->>'operationId')::uuid;current_gen:=(a->>'generation')::bigint;
 first_plan:=jsonb_build_object('provider','daily','leaseId',a->>'leaseId','publisherIdentity',a->>'identity',
  'generation',current_gen,'roomId','nv_'||replace(gen_random_uuid()::text,'-',''),
  'expiresAt',to_char(date_trunc('second',(a->>'expiresAt')::timestamptz) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 first_plan:=first_plan||jsonb_build_object('roomUrl','https://fixture.daily.co/'||(first_plan->>'roomId'));
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,
  'plan',first_plan||jsonb_build_object('leaseId',gen_random_uuid())),speaker_token);
 if b->>'status' is distinct from '400' then raise exception 'Mismatched Daily lease accepted: %',b;end if;
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,
  'plan',first_plan||jsonb_build_object('expiresAt',clock_timestamp()+interval '1 hour')),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Daily deadline extended floor: %',b;end if;
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',first_plan),speaker_token);
 if b->'plan' is distinct from first_plan or (b->>'expiresAt')::timestamptz is distinct from (first_plan->>'expiresAt')::timestamptz
  or b->>'dutyId' is distinct from speaker_duty::text then raise exception 'Daily plan not durably bound: %',b;end if;
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',first_plan),speaker_token);
 if b->'plan' is distinct from first_plan then raise exception 'Exact persisted plan retry was not idempotent: %',b;end if;
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,
  'plan',first_plan||jsonb_build_object('roomId','nv_'||repeat('0',32),'roomUrl','https://fixture.daily.co/nv_'||repeat('0',32))),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Immutable plan changed: %',b;end if;
 b:=navrang_private.voice_rpc('floor-commit',jsonb_build_object('operationId',current_op,'generation',current_gen),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Legacy commit bypassed Daily receipt: %',b;end if;
 receipt:=jsonb_build_object('provider','daily','roomId',first_plan->>'roomId','leaseId',first_plan->>'leaseId',
  'generation',first_plan->'generation','expiresAt',first_plan->>'expiresAt','grantVerified',true,'mediaTerminationVerified',false);
 b:=navrang_private.voice_rpc('daily-commit',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',first_plan,'receipt',receipt),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Control-plane-only room creation activated voice: %',b;end if;
 receipt:=receipt||'{"mediaTerminationVerified":true}'::jsonb;
 b:=navrang_private.voice_rpc('daily-commit',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',first_plan,'receipt',receipt),speaker_token);
 if b->>'state' is distinct from 'active' then raise exception 'Synthetic exact Daily commit failed: %',b;end if;
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',speaker_duty,'sessionId',voice_session),speaker_token);
 b:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',listener_duty,'sessionId',voice_session),listener_token);
 if a->>'state' is distinct from 'speaking' or b->>'state' is distinct from 'listening' or a->'plan' is distinct from first_plan
  or b->'plan' is distinct from first_plan or a->>'identity'=b->>'identity' then raise exception 'Daily discovery identities incorrect: %, %',a,b;end if;
 b:=navrang_private.voice_rpc('voice-renew',jsonb_build_object('sessionId',voice_session,'leaseId',first_plan->>'leaseId'),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Daily room renewed in place: %',b;end if;
 b:=navrang_private.voice_rpc('daily-renew-prepare',jsonb_build_object('sessionId',voice_session,'leaseId',gen_random_uuid()),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Missing request/wrong lease rotated Daily room: %',b;end if;
 a:=navrang_private.voice_rpc('daily-renew-prepare',jsonb_build_object('sessionId',voice_session,'leaseId',first_plan->>'leaseId','requestId',gen_random_uuid()),speaker_token);
 current_op:=(a->>'operationId')::uuid;current_gen:=(a->>'generation')::bigint;command:=a->'revoke'->0;
 if command->'plan' is distinct from first_plan or command->>'commandId' is null or a->>'leaseId'=first_plan->>'leaseId' then raise exception 'Renewal lost old immutable room: %',a;end if;
 next_plan:=first_plan||jsonb_build_object('leaseId',a->>'leaseId','generation',current_gen,
  'expiresAt',to_char(date_trunc('second',(a->>'expiresAt')::timestamptz) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',next_plan),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'Old room name reused by successor lease: %',b;end if;
 next_plan:=next_plan||jsonb_build_object('roomId','nv_'||replace(gen_random_uuid()::text,'-',''));
 next_plan:=next_plan||jsonb_build_object('roomUrl','https://fixture.daily.co/'||(next_plan->>'roomId'));
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',next_plan),speaker_token);
 if b->'plan' is distinct from next_plan then raise exception 'Rotated plan not persisted: %',b;end if;
 receipt:=jsonb_build_object('provider','daily','roomId',next_plan->>'roomId','leaseId',next_plan->>'leaseId',
  'generation',next_plan->'generation','expiresAt',next_plan->>'expiresAt','grantVerified',true,'mediaTerminationVerified',true);
 b:=navrang_private.voice_rpc('daily-commit',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',next_plan,'receipt',receipt),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'New publisher committed before old room removal: %',b;end if;
 b:=navrang_private.voice_ack_revoke((command->>'commandId')::uuid,(command->>'generation')::bigint);
 if b->>'status' is distinct from '409' then raise exception 'Participant ACK accepted for immutable room: %',b;end if;
 receipt:=jsonb_build_object('provider','daily','roomId',first_plan->>'roomId','leaseId',first_plan->>'leaseId',
  'generation',first_plan->'generation','expiresAt',first_plan->>'expiresAt','deleted',true,'absenceObserved',true,'mediaTerminationVerified',true);
 b:=navrang_private.voice_rpc('daily-ack',command||jsonb_build_object('receipt',receipt),listener_token);
 if b->>'status' is distinct from '403' then raise exception 'Unrelated listener acknowledged preemption: %',b;end if;
 b:=navrang_private.voice_rpc('daily-ack',command||jsonb_build_object('receipt',receipt||'{"mediaTerminationVerified":false}'::jsonb),speaker_token);
 if b->>'status' is distinct from '409' then raise exception 'GET absence counted as media termination: %',b;end if;
 b:=navrang_private.voice_rpc('daily-ack',command||jsonb_build_object('receipt',receipt),speaker_token);
 if b->>'state' is distinct from 'acked' then raise exception 'Exact foreground room ACK failed: %',b;end if;
 receipt:=jsonb_build_object('provider','daily','roomId',next_plan->>'roomId','leaseId',next_plan->>'leaseId',
  'generation',next_plan->'generation','expiresAt',next_plan->>'expiresAt','grantVerified',true,'mediaTerminationVerified',true);
 b:=navrang_private.voice_rpc('daily-commit',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',next_plan,'receipt',receipt),speaker_token);
 if b->>'state' is distinct from 'active' then raise exception 'Rotated grant failed after exact removal: %',b;end if;
 -- Listener logout closes its room, including when the publisher is still valid.
 delete from navrang_private.sessions where hash in (listener_token,other_listener_token);
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',speaker_duty,'sessionId',voice_session),speaker_token);
 if a->>'state' is distinct from 'idle' or (select phase from navrang_private.voice_floors where session_id=voice_session)<>'revoking' then raise exception 'Revoked listener retained active Daily room: %',a;end if;
 a:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',owner_id),'');
 a:=navrang_private.voice_rpc('controller-poll',jsonb_build_object('controllerId',owner_id),'');
 select value into command from jsonb_array_elements(a->'commands') where value->'plan'=next_plan limit 1;
 if command is null then raise exception 'Controller lost saved Daily room plan: %',a;end if;
 if (select count(*) from navrang_private.voice_commands where daily_plan=next_plan and operation='revoke' and state<>'acked')<>2 then
  raise exception 'Two revoked listeners did not retain both cleanup identities';
 end if;
 b:=navrang_private.voice_rpc('controller-ack',jsonb_build_object('controllerId',owner_id,'commandId',command->>'commandId','generation',command->'generation'),'');
 if b->>'status' is distinct from '409' then raise exception 'Ordinary controller ACK bypassed Daily receipt: %',b;end if;
 receipt:=jsonb_build_object('provider','daily','roomId',next_plan->>'roomId','leaseId',next_plan->>'leaseId',
  'generation',next_plan->'generation','expiresAt',next_plan->>'expiresAt','deleted',true,'absenceObserved',true,'mediaTerminationVerified',true);
 c:=jsonb_build_object('controllerId',owner_id,'commandId',command->>'commandId','operationId',command->>'operationId',
  'generation',command->'generation','plan',next_plan,'receipt',receipt);
 b:=navrang_private.voice_rpc('controller-daily-ack',c,speaker_token);
 if b->>'status' is distinct from '403' then raise exception 'App bearer entered Daily controller ACK: %',b;end if;
 b:=navrang_private.voice_rpc('controller-daily-ack',c||jsonb_build_object('receipt',receipt||jsonb_build_object('roomId',first_plan->>'roomId')),'');
 if b->>'status' is distinct from '409' then raise exception 'Mismatched room receipt accepted: %',b;end if;
 update navrang_private.voice_runtime set controller_until=clock_timestamp()-interval '1 second';
 b:=navrang_private.voice_rpc('controller-daily-ack',c,'');
 if b->>'status' is distinct from '409' then raise exception 'Expired controller acknowledged Daily room: %',b;end if;
 a:=navrang_private.voice_rpc('controller-claim',jsonb_build_object('controllerId',owner_id),'');
 b:=navrang_private.voice_rpc('controller-daily-ack',c,'');
 if b->>'state' is distinct from 'acked' or (select phase from navrang_private.voice_floors where session_id=voice_session)<>'idle' then raise exception 'Exact controller cleanup failed: %',b;end if;
 if exists(select 1 from navrang_private.voice_members where duty_id in (listener_duty,other_listener_duty) and session_id=voice_session)
  or exists(select 1 from navrang_private.voice_commands where daily_plan=next_plan and operation='revoke' and state<>'acked') then
  raise exception 'One exact room removal did not clear both revoked listener identities and commands';
 end if;
 -- A failed rotation must retain BOTH old-room and new-room cleanup even when
 -- their publisher identity is identical (the legacy command uniqueness key).
 update navrang_private.voice_runtime set worker_at=clock_timestamp();
 a:=navrang_private.voice_rpc('floor-prepare',jsonb_build_object('sessionId',voice_session,'requestId',gen_random_uuid()),speaker_token);
 current_op:=(a->>'operationId')::uuid;current_gen:=(a->>'generation')::bigint;
 third_plan:=next_plan||jsonb_build_object('leaseId',a->>'leaseId','generation',current_gen,
  'roomId','nv_'||replace(gen_random_uuid()::text,'-',''),'expiresAt',to_char(date_trunc('second',(a->>'expiresAt')::timestamptz) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 third_plan:=third_plan||jsonb_build_object('roomUrl','https://fixture.daily.co/'||(third_plan->>'roomId'));
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',third_plan),speaker_token);
 receipt:=jsonb_build_object('provider','daily','roomId',third_plan->>'roomId','leaseId',third_plan->>'leaseId',
  'generation',third_plan->'generation','expiresAt',third_plan->>'expiresAt','grantVerified',true,'mediaTerminationVerified',true);
 b:=navrang_private.voice_rpc('daily-commit',jsonb_build_object('operationId',current_op,'generation',current_gen,'plan',third_plan,'receipt',receipt),speaker_token);
 if b->>'state' is distinct from 'active' then raise exception 'Second fixture grant failed: %',b;end if;
 a:=navrang_private.voice_rpc('daily-renew-prepare',jsonb_build_object('sessionId',voice_session,'leaseId',third_plan->>'leaseId','requestId',gen_random_uuid()),speaker_token);
 next_op:=(a->>'operationId')::uuid;current_gen:=(a->>'generation')::bigint;
 next_plan:=third_plan||jsonb_build_object('leaseId',a->>'leaseId','generation',current_gen,
  'roomId','nv_'||replace(gen_random_uuid()::text,'-',''),'expiresAt',to_char(date_trunc('second',(a->>'expiresAt')::timestamptz) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 next_plan:=next_plan||jsonb_build_object('roomUrl','https://fixture.daily.co/'||(next_plan->>'roomId'));
 b:=navrang_private.voice_rpc('daily-plan',jsonb_build_object('operationId',next_op,'generation',current_gen,'plan',next_plan),speaker_token);
 b:=navrang_private.voice_rpc('floor-fail',jsonb_build_object('operationId',next_op,'generation',current_gen,'ambiguousGrant',true),speaker_token);
 if b->>'state' is distinct from 'revoking' or not exists(select 1 from navrang_private.voice_commands where operation='revoke' and daily_plan=third_plan and state<>'acked')
  or not exists(select 1 from navrang_private.voice_commands where operation='revoke' and daily_plan=next_plan and state<>'acked')
  or navrang_private.voice_ready() then raise exception 'Ambiguous rotation lost a room or escaped quarantine: %',b;end if;
end;
$daily_test$;

-- Channel listeners discover only a currently authorized administrator broadcast.
do $broadcast_discovery$
declare
 admin_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 allowed_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 excluded_token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 allowed_id uuid:=gen_random_uuid();excluded_id uuid:=gen_random_uuid();
 admin_duty uuid;allowed_duty uuid;excluded_duty uuid;channel_id uuid;broadcast_id uuid;
 publisher uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();until_at timestamptz;
 admin_principal text;a jsonb;plan jsonb;
begin
 update navrang_private.voice_commands set state='acked' where state<>'acked';
 update navrang_private.voice_floors set phase='idle',daily_plan=null;
 update navrang_private.voice_sessions set state='ended' where kind<>'channel';
 update navrang_private.voice_runtime set configured=true,revocation_verified=true,lease_enforced=true,
  worker_death_verified=true,revocation_mode='guarded-admission',worker_at=clock_timestamp();
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station)
 values(allowed_id,'Broadcast included fixture','code',true,true,true,'checker'),
  (excluded_id,'Broadcast excluded fixture','code',true,true,true,'checker');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(admin_token,'admin',null,clock_timestamp()+interval '1 hour'),
  (allowed_token,'checker',allowed_id,clock_timestamp()+interval '1 hour'),
  (excluded_token,'checker',excluded_id,clock_timestamp()+interval '1 hour');
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"broadcast-admin-fixture"}',admin_token);
 admin_duty:=(a->>'dutyId')::uuid;channel_id:=(a->>'sessionId')::uuid;
 select principal into admin_principal from navrang_private.voice_duty where id=admin_duty;
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"broadcast-included-fixture"}',allowed_token);
 allowed_duty:=(a->>'dutyId')::uuid;
 a:=navrang_private.voice_rpc('duty-join','{"installationId":"broadcast-excluded-fixture"}',excluded_token);
 excluded_duty:=(a->>'dutyId')::uuid;
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',allowed_duty,'sessionId',channel_id),allowed_token);
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',excluded_duty,'sessionId',channel_id),excluded_token);
 insert into navrang_private.voice_sessions(kind,owner_principal,audience)
 values('broadcast',admin_principal,jsonb_build_object('type','staff','staffIds',jsonb_build_array(allowed_id::text))) returning id into broadcast_id;
 until_at:=date_trunc('second',clock_timestamp()+interval '14 seconds');
 plan:=jsonb_build_object('provider','daily','leaseId',lease,'publisherIdentity',publisher,'generation',1,
  'roomId','nv_'||replace(gen_random_uuid()::text,'-',''),'expiresAt',to_char(until_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 plan:=plan||jsonb_build_object('roomUrl','https://fixture.daily.co/'||(plan->>'roomId'));
 insert into navrang_private.voice_floors(session_id,generation,phase,principal,identity,duty_id,lease_id,expires_at,daily_plan)
 values(broadcast_id,1,'active',admin_principal,publisher,admin_duty,lease,until_at,plan);
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',allowed_duty,'sessionId',channel_id),allowed_token);
 if a->>'sessionId' is distinct from broadcast_id::text or a->>'state' is distinct from 'listening' or a->'plan' is distinct from plan then
  raise exception 'Included channel listener did not discover authorized broadcast: %',a;end if;
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',excluded_duty,'sessionId',channel_id),excluded_token);
 if a->>'sessionId' is distinct from channel_id::text or a->>'state' is distinct from 'idle' or a->'plan' is distinct from 'null'::jsonb then
  raise exception 'Excluded listener received broadcast data: %',a;end if;
 a:=navrang_private.voice_rpc('voice-join',jsonb_build_object('dutyId',excluded_duty,'sessionId',broadcast_id),excluded_token);
 if a->>'status' is distinct from '403' then raise exception 'Direct broadcast join bypassed audience: %',a;end if;
 update navrang_private.checkers set active=false where id=allowed_id;
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',allowed_duty,'sessionId',channel_id),allowed_token);
 if a->>'status' is distinct from '403' or a ? 'plan' then raise exception 'Revoked staff retained broadcast discovery: %',a;end if;
 update navrang_private.checkers set active=true where id=allowed_id;
 delete from navrang_private.sessions where hash=admin_token;
 a:=navrang_private.voice_rpc('daily-receive',jsonb_build_object('dutyId',allowed_duty,'sessionId',channel_id),allowed_token);
 if a->>'state'='listening' or coalesce(a->'plan','null'::jsonb)<>'null'::jsonb then
  raise exception 'Broadcast remained discoverable after administrator sign-out: %',a;end if;
end;
$broadcast_discovery$;
rollback;
