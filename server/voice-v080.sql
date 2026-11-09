-- Additive, private voice state preparation. Apply after communications-v080.sql.
-- No relay credentials/tokens are stored or minted. Transport remains NOT_RUN.
-- A persistent authenticated controller reconciles expiration; independent,
-- relay-enforced media deadlines must still survive its death. Neither SQL
-- leases nor a fresh controller heartbeat stop active media at LiveKit Cloud.
create table if not exists navrang_private.voice_runtime (
 singleton boolean primary key default true check(singleton),
 configured boolean not null default false,revocation_verified boolean not null default false,
 revocation_mode text not null default 'disabled' check(revocation_mode in ('disabled','cloud-explicit-cutoff','guarded-admission')),
 worker_at timestamptz
);
insert into navrang_private.voice_runtime(singleton) values(true) on conflict do nothing;
-- Additive for installations that already applied the preparation schema.
alter table navrang_private.voice_runtime add column if not exists lease_enforced boolean not null default false;
alter table navrang_private.voice_runtime add column if not exists worker_death_verified boolean not null default false;
alter table navrang_private.voice_runtime add column if not exists controller_id uuid;
alter table navrang_private.voice_runtime add column if not exists controller_until timestamptz;
alter table navrang_private.voice_runtime add column if not exists controller_at timestamptz;
create table if not exists navrang_private.voice_duty (
 id uuid primary key default gen_random_uuid(),principal text not null,
 -- Keep this hash after logout until relay revocation is acknowledged. A cascade
 -- would erase the identity needed for removal (and a floor FK could block logout).
 session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),
 installation_id text not null check(length(installation_id) between 1 and 128),
 active boolean not null default true,expires_at timestamptz not null,
 unique(principal,installation_id)
);
create table if not exists navrang_private.voice_sessions (
 id uuid primary key default gen_random_uuid(),room uuid not null default gen_random_uuid() unique,
 kind text not null check(kind in ('channel','broadcast','private')),
 owner_principal text not null,audience jsonb not null,
 state text not null default 'active' check(state in ('active','ending','ended')),
 request_id uuid,created_at timestamptz not null default clock_timestamp(),
 unique(owner_principal,request_id)
);
create unique index if not exists voice_single_channel on navrang_private.voice_sessions(kind) where kind='channel' and state='active';
create table if not exists navrang_private.voice_members (
 session_id uuid not null references navrang_private.voice_sessions(id),
 duty_id uuid not null references navrang_private.voice_duty(id) on delete cascade,
 identity uuid not null default gen_random_uuid() unique,
 primary key(session_id,duty_id)
);
create table if not exists navrang_private.voice_floors (
 session_id uuid primary key references navrang_private.voice_sessions(id),
 generation bigint not null default 0,phase text not null default 'idle' check(phase in ('idle','granting','active','revoking')),
 principal text,identity uuid,duty_id uuid references navrang_private.voice_duty(id),
 lease_id uuid,expires_at timestamptz,operation_id uuid,
 request_id uuid
);
create table if not exists navrang_private.voice_commands (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null,
 session_id uuid not null references navrang_private.voice_sessions(id),
 room uuid not null,identity uuid not null,generation bigint not null,
 operation text not null check(operation in ('revoke','grant')),
 state text not null default 'pending' check(state in ('pending','acked','failed')),
 created_at timestamptz not null default clock_timestamp(),acked_at timestamptz,
 unique(operation_id,session_id,identity,operation)
);
create index if not exists voice_commands_pending on navrang_private.voice_commands(state,created_at);
-- Provider room plans contain no credentials. Grant history reserves every
-- immutable Daily room name permanently, including uncertain create outcomes.
alter table navrang_private.voice_floors add column if not exists daily_plan jsonb;
alter table navrang_private.voice_commands add column if not exists daily_plan jsonb;
create unique index if not exists voice_daily_grant_room on navrang_private.voice_commands((daily_plan->>'roomId'))
 where operation='grant' and daily_plan is not null;
do $acl$
declare name text;
begin
 foreach name in array array['voice_runtime','voice_duty','voice_sessions','voice_members','voice_floors','voice_commands'] loop
  execute format('alter table navrang_private.%I enable row level security',name);
  execute format('revoke all on navrang_private.%I from public,anon,authenticated',name);
  execute format('grant select,insert,update,delete on navrang_private.%I to service_role',name);
 end loop;
end;
$acl$;

create or replace function navrang_private.voice_allowed(actor jsonb,audience jsonb,owner_principal text)
returns boolean language sql security invoker set search_path='' as $allowed$
 select coalesce(actor->>'active'='true' and (actor->>'admin'='true' or actor->>'scanner'='true' or actor->>'helpdesk'='true' or actor->>'faculty'='true') and (
  actor->>'principal'=owner_principal or audience->>'type'='everyone' or
  (audience->>'type'='staff' and audience->'staffIds' ? (actor->>'principal')) or
  (audience->>'type'='roles' and (
   ((audience->'roles' ? 'administrator') and actor->>'admin'='true') or
   ((audience->'roles' ? 'checker') and actor->>'scanner'='true') or
   ((audience->'roles' ? 'helpdesk') and actor->>'helpdesk'='true') or
   ((audience->'roles' ? 'faculty') and actor->>'faculty'='true')
  ))),false);
$allowed$;
revoke all on function navrang_private.voice_allowed(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.voice_allowed(jsonb,jsonb,text) to service_role;

create or replace function navrang_private.voice_ready()
returns boolean language sql security invoker set search_path='' as $ready$
 select coalesce((select configured and lease_enforced and worker_death_verified
 and revocation_verified and revocation_mode in ('cloud-explicit-cutoff','guarded-admission')
 and worker_at between clock_timestamp()-interval '3 seconds' and clock_timestamp()+interval '1 second'
 from navrang_private.voice_runtime where singleton),false)
 and not exists(select 1 from navrang_private.voice_commands where operation='grant' and state='failed');
$ready$;
revoke all on function navrang_private.voice_ready() from public,anon,authenticated;
grant execute on function navrang_private.voice_ready() to service_role;

-- Called only by a narrowly authenticated server worker, not the client router.
-- Returns durable revocation work; marking the database expired is not relay ACK.
create or replace function navrang_private.voice_expire()
returns jsonb language plpgsql security invoker set search_path='' as $expire$
declare f record;op uuid;checked_at timestamptz:=clock_timestamp();result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 update navrang_private.voice_duty set active=false where expires_at<=checked_at;
 for f in select floors.*,s.room from navrang_private.voice_floors floors
 join navrang_private.voice_sessions s on s.id=floors.session_id
 left join navrang_private.voice_duty d on d.id=floors.duty_id
 where floors.phase in ('active','granting') and
  (floors.expires_at<=checked_at or s.state<>'active' or not coalesce(d.active,false) or d.expires_at<=checked_at or
   (s.kind='broadcast' and (navrang_private.resolve_actor(d.session_hash)->>'admin') is distinct from 'true') or
   not navrang_private.voice_allowed(navrang_private.resolve_actor(d.session_hash),s.audience,s.owner_principal))
 for update of floors
 loop
  op:=gen_random_uuid();
  -- A lost coordinator can have a grant RPC still in flight. Do not allow a
  -- replacement publisher merely because a subsequent revoke was acknowledged;
  -- the transport operator must reconcile that ambiguous command first.
  if f.phase='granting' then
   update navrang_private.voice_commands set state='failed' where operation_id=f.operation_id and operation='grant' and state='pending';
  end if;
  update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=f.session_id;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation,daily_plan)
  values(op,f.session_id,f.room,f.identity,f.generation+1,'revoke',f.daily_plan);
  update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
 end loop;
 -- Listening memberships also need authoritative removal after logout, role
 -- revocation or duty expiry, even if that member never held a speaking floor.
 for f in select m.session_id,m.identity,s.room,floors.generation,floors.daily_plan,floors.phase,floors.operation_id
 from navrang_private.voice_members m join navrang_private.voice_duty d on d.id=m.duty_id
 join navrang_private.voice_sessions s on s.id=m.session_id
 join navrang_private.voice_floors floors on floors.session_id=s.id
 where (not d.active or d.expires_at<=checked_at or s.state<>'active' or
  not navrang_private.voice_allowed(navrang_private.resolve_actor(d.session_hash),s.audience,s.owner_principal))
 and not exists(select 1 from navrang_private.voice_commands commands where commands.identity=m.identity
  and commands.operation='revoke' and commands.state in ('pending','failed'))
 loop
  op:=gen_random_uuid();
  if f.daily_plan is not null then
   -- A room credential is reusable until room destruction. Removing one
   -- listener therefore closes the whole immutable room before any successor.
   if f.phase='granting' then
    update navrang_private.voice_commands set state='failed' where operation_id=f.operation_id and operation='grant' and state='pending';
   end if;
   update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op
    where session_id=f.session_id and phase in ('active','granting');
   update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
   select generation,operation_id into f.generation,op from navrang_private.voice_floors where session_id=f.session_id;
  end if;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation,daily_plan)
  values(op,f.session_id,f.room,f.identity,f.generation,'revoke',f.daily_plan) on conflict do nothing;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'operationId',operation_id,'sessionId',session_id,'room',room,'identity',identity,'generation',generation,'operation',operation,'plan',daily_plan) order by created_at,id),'[]'::jsonb)
 into result from navrang_private.voice_commands where state in ('pending','failed') and operation='revoke';
 return jsonb_build_object('commands',result,'transport','NOT_RUN');
end;
$expire$;
revoke all on function navrang_private.voice_expire() from public,anon,authenticated;
grant execute on function navrang_private.voice_expire() to service_role;

-- ACK follows a verified strict relay removal, not simply a worker HTTP request.
create or replace function navrang_private.voice_ack_revoke(p_command uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path='' as $ack$
declare command navrang_private.voice_commands%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 select * into command from navrang_private.voice_commands where id=p_command and generation=p_generation and operation='revoke' for update;
 if not found then return jsonb_build_object('error','Removal command is stale.','status',409);end if;
 if command.daily_plan is not null then return jsonb_build_object('error','Exact Daily room removal receipt required.','status',409);end if;
 update navrang_private.voice_commands set state='acked',acked_at=clock_timestamp() where id=p_command;
 delete from navrang_private.voice_members members where members.identity=command.identity
 and not exists(select 1 from navrang_private.voice_floors floors where floors.identity=members.identity and floors.phase in ('active','granting'));
 if not exists(select 1 from navrang_private.voice_commands where operation_id=command.operation_id and operation='revoke' and state<>'acked') then
  update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null,daily_plan=null
  where operation_id=command.operation_id and phase='revoking';
 end if;
 update navrang_private.voice_sessions s set state='ended' where s.state='ending'
 and not exists(select 1 from navrang_private.voice_floors f where f.session_id=s.id and f.phase<>'idle')
 and not exists(select 1 from navrang_private.voice_commands c where c.session_id=s.id and c.operation='revoke' and c.state<>'acked');
 return jsonb_build_object('state','acked');
end;
$ack$;
revoke all on function navrang_private.voice_ack_revoke(uuid,bigint) from public,anon,authenticated;
grant execute on function navrang_private.voice_ack_revoke(uuid,bigint) to service_role;

create or replace function navrang_private.voice_rpc(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $voice$
declare
 actor jsonb;principal_key text;checked_at timestamptz:=clock_timestamp();
 d navrang_private.voice_duty%rowtype;s navrang_private.voice_sessions%rowtype;
 f navrang_private.voice_floors%rowtype;member navrang_private.voice_members%rowtype;
 prior record;op uuid;audience jsonb;revokes jsonb;result jsonb;
 runtime navrang_private.voice_runtime%rowtype;controller uuid;
 command navrang_private.voice_commands%rowtype;plan jsonb;receipt jsonb;plan_expiry timestamptz;
 controller_ack boolean:=false;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 then return jsonb_build_object('error','Invalid voice payload.','status',400);end if;
 -- These internal actions use the existing private function and its unchanged
 -- service-only ACL. They are never added to any public/app action allowlist.
 -- An app bearer is explicitly rejected, even through a privileged bridge.
 if p_action in ('controller-claim','controller-poll','controller-ack','controller-daily-ack','controller-relay-ack','controller-heartbeat','controller-release') then
  if p_token is distinct from '' or not pg_catalog.pg_has_role(current_user,'service_role','USAGE') then
   return jsonb_build_object('error','Authorized controller connection required.','status',403);
  end if;
  if p - (case when p_action='controller-ack' then array['controllerId','commandId','generation']
    when p_action in ('controller-daily-ack','controller-relay-ack') then array['controllerId','operationId','commandId','generation','plan','receipt'] else array['controllerId'] end) <> '{}'::jsonb then
   return jsonb_build_object('error','Invalid controller payload.','status',400);
  end if;
  controller:=(p->>'controllerId')::uuid;
  if controller is null then return jsonb_build_object('error','Controller identity required.','status',400);end if;
  perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
  checked_at:=clock_timestamp();
  select * into runtime from navrang_private.voice_runtime where singleton for update;
  if p_action='controller-claim' then
   if runtime.controller_id is distinct from controller and runtime.controller_until>checked_at then
    return jsonb_build_object('error','Another controller owns reconciliation.','status',409);
   end if;
   update navrang_private.voice_runtime set controller_id=controller,controller_until=checked_at+interval '5 seconds',
    worker_at=case when runtime.controller_id=controller and runtime.controller_until>checked_at then worker_at else null end
   where singleton;
   return jsonb_build_object('claimed',true,'until',checked_at+interval '5 seconds');
  end if;
  if runtime.controller_id is distinct from controller or runtime.controller_until is null or runtime.controller_until<=checked_at then
   return jsonb_build_object('error','Controller lease expired.','status',409);
  end if;
  if p_action='controller-poll' then
   result:=navrang_private.voice_expire();
   select coalesce(jsonb_agg(item),'[]'::jsonb) into revokes
   from (select value as item from jsonb_array_elements(result->'commands') limit 32) bounded;
   return jsonb_build_object('commands',revokes,'more',jsonb_array_length(result->'commands')>32);
  elsif p_action='controller-ack' then
   return navrang_private.voice_ack_revoke((p->>'commandId')::uuid,(p->>'generation')::bigint);
  elsif p_action in ('controller-daily-ack','controller-relay-ack') then
   controller_ack:=true;
  elsif p_action='controller-heartbeat' then
   -- Liveness is not proof of active-media expiry. Safety acceptance flags
   -- remain operator-owned, false by default, and cannot be supplied here.
   update navrang_private.voice_runtime set controller_at=checked_at,
    worker_at=case when configured and revocation_verified and lease_enforced and worker_death_verified
     and revocation_mode in ('cloud-explicit-cutoff','guarded-admission')
     -- New work can arrive after the controller's successful poll/ACK cycle.
     -- Do not invalidate a healthy concurrent grant; ambiguous grants retain
     -- their separate durable failed-state quarantine in voice_ready().
     and not exists(select 1 from navrang_private.voice_commands where operation='grant' and state='failed') then checked_at else null end
   where singleton;
   return jsonb_build_object('observed',true);
  else
   update navrang_private.voice_runtime set controller_id=null,controller_until=null,worker_at=null where singleton;
   return jsonb_build_object('released',true);
  end if;
 end if;
 if not controller_ack then
 actor:=navrang_private.resolve_actor(p_token);
 if actor ? 'error' then return actor;end if;
 if not navrang_private.voice_allowed(actor,'{"type":"everyone"}','') then return jsonb_build_object('error','Approved staff access required.','status',403);end if;
 principal_key:=actor->>'principal';
 -- All state mutations share one short database lock. Never hold it during HTTP.
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 checked_at:=clock_timestamp();
 if p_action not in ('duty-leave','voice-release','voice-broadcast-end','floor-fail','daily-ack','relay-ack','relay-operation') and not navrang_private.voice_ready() then
  return jsonb_build_object('error','Voice provider or expiry worker is not ready.','status',503);
 end if;
 end if;
 if p_action in ('daily-ack','controller-daily-ack','relay-ack','controller-relay-ack') then
  if not controller_ack and not exists(select 1 from navrang_private.voice_floors floors
   join navrang_private.voice_duty duty on duty.id=floors.duty_id
   where floors.operation_id=(p->>'operationId')::uuid and floors.principal=principal_key and floors.phase='granting'
    and floors.expires_at>checked_at and duty.active and duty.expires_at>checked_at and duty.session_hash=p_token) then
   return jsonb_build_object('error','Current floor operation required.','status',403);
  end if;
  select * into command from navrang_private.voice_commands where id=(p->>'commandId')::uuid
   and operation_id=(p->>'operationId')::uuid and generation=(p->>'generation')::bigint and operation='revoke' for update;
  plan:=p->'plan';receipt:=p->'receipt';
  if not found or command.daily_plan is null or command.daily_plan is distinct from plan
   or ((case when p_action in ('relay-ack','controller-relay-ack') then
      plan->>'provider'='navrang-relay-v1' and receipt->>'provider'='navrang-relay-v1'
      and jsonb_typeof(receipt)='object'
      and receipt - array['provider','revoked','forwardingStopped','mediaTerminationVerified','roomId','leaseId','generation','expiresAt']='{}'::jsonb
      and receipt->'revoked'='true'::jsonb and receipt->'forwardingStopped'='true'::jsonb
     else plan->>'provider'='daily' and receipt->>'provider'='daily'
      and receipt->'deleted'='true'::jsonb and receipt->'absenceObserved'='true'::jsonb end)
    and receipt->'mediaTerminationVerified'='true'::jsonb and receipt->>'roomId'=plan->>'roomId'
    and receipt->>'leaseId'=plan->>'leaseId' and receipt->'generation'=plan->'generation'
    and receipt->>'expiresAt'=plan->>'expiresAt') is distinct from true then
   return jsonb_build_object('error','Exact verified Daily room removal required.','status',409);
  end if;
  -- One strictly verified destruction covers every removal for this exact
  -- immutable room. Otherwise a second listener's DELETE could return 404 and
  -- leave its command pending forever despite the first verified destruction.
  update navrang_private.voice_commands set state='acked',acked_at=checked_at
   where operation='revoke' and daily_plan=plan and state<>'acked';
  delete from navrang_private.voice_members members where exists(
   select 1 from navrang_private.voice_commands commands where commands.operation='revoke'
    and commands.daily_plan=plan and commands.identity=members.identity)
   and not exists(select 1 from navrang_private.voice_floors floors where floors.identity=members.identity and floors.phase in ('active','granting'));
  update navrang_private.voice_floors floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null,daily_plan=null
   where floors.phase='revoking' and exists(select 1 from navrang_private.voice_commands commands
    where commands.operation_id=floors.operation_id and commands.operation='revoke' and commands.daily_plan=plan)
   and not exists(select 1 from navrang_private.voice_commands commands
    where commands.operation_id=floors.operation_id and commands.operation='revoke' and commands.state<>'acked');
  update navrang_private.voice_sessions sessions set state='ended' where sessions.state='ending'
   and not exists(select 1 from navrang_private.voice_floors floors where floors.session_id=sessions.id and floors.phase<>'idle')
   and not exists(select 1 from navrang_private.voice_commands commands where commands.session_id=sessions.id and operation='revoke' and state<>'acked');
  return jsonb_build_object('state','acked');
 end if;
 if p_action='duty-join' then
  if coalesce(p->>'installationId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then return jsonb_build_object('error','Invalid installation identifier.','status',400);end if;
  insert into navrang_private.voice_duty as duty(principal,session_hash,installation_id,expires_at)
  values(principal_key,p_token,p->>'installationId',checked_at+interval '60 seconds')
  on conflict(principal,installation_id) do update set session_hash=excluded.session_hash,active=true,expires_at=excluded.expires_at returning * into d;
  insert into navrang_private.voice_sessions(kind,owner_principal,audience) values('channel','', '{"type":"everyone"}')
  on conflict(kind) where kind='channel' and state='active' do nothing;
  select * into s from navrang_private.voice_sessions where kind='channel' and state='active';
  insert into navrang_private.voice_floors(session_id) values(s.id) on conflict do nothing;
  return jsonb_build_object('dutyId',d.id,'expiresAt',d.expires_at,'sessionId',s.id,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
 elsif p_action in ('duty-heartbeat','duty-leave') then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token;
  if not found or not d.active or d.expires_at<=checked_at then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  update navrang_private.voice_duty set active=p_action<>'duty-leave',expires_at=case when p_action='duty-leave' then checked_at else checked_at+interval '60 seconds' end where id=d.id returning * into d;
  if p_action='duty-leave' then perform navrang_private.voice_expire();end if;
  return jsonb_build_object('dutyId',d.id,'active',p_action<>'duty-leave','expiresAt',d.expires_at,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
 elsif p_action in ('voice-broadcast-start','voice-invite') then
  if actor->>'admin'<>'true' then return jsonb_build_object('error','Administrator access required.','status',403);end if;
  select * into d from navrang_private.voice_duty where principal=principal_key and session_hash=p_token and active and expires_at>checked_at order by expires_at desc limit 1;
  if not found then return jsonb_build_object('error','Enable On duty first.','status',403);end if;
  audience:=case when p_action='voice-invite' then jsonb_build_object('type','staff','staffIds',jsonb_build_array((p->>'staffId')::uuid)) else p->'audience' end;
  if audience->>'type' not in ('everyone','roles','staff') or audience is null then return jsonb_build_object('error','Invalid audience.','status',400);end if;
  if p_action='voice-broadcast-start' and exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state in ('active','ending') and request_id is distinct from (p->>'requestId')::uuid) then
   return jsonb_build_object('error','End the current administrator broadcast first.','status',409);
  end if;
  if p_action='voice-broadcast-start' and exists(select 1 from navrang_private.voice_floors where phase in ('granting','revoking')) then
   return jsonb_build_object('error','Wait for the pending relay operation before starting a broadcast.','status',409);
  end if;
  if p_action='voice-invite' and not exists(select 1 from navrang_private.voice_duty duty where duty.principal=p->>'staffId' and duty.active and duty.expires_at>checked_at and
   navrang_private.voice_allowed(navrang_private.resolve_actor(duty.session_hash),'{"type":"everyone"}','')) then
   return jsonb_build_object('error','Selected staff member is not available on duty.','status',409);
  end if;
  insert into navrang_private.voice_sessions(kind,owner_principal,audience,request_id)
  values(case when p_action='voice-invite' then 'private' else 'broadcast' end,principal_key,audience,(p->>'requestId')::uuid)
  on conflict(owner_principal,request_id) do nothing;
  select * into s from navrang_private.voice_sessions where owner_principal=principal_key and request_id=(p->>'requestId')::uuid;
  if s.state<>'active' or s.audience is distinct from audience or s.kind is distinct from (case when p_action='voice-invite' then 'private' else 'broadcast' end) then return jsonb_build_object('error','Request identifier reused.','status',409);end if;
  insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
  insert into navrang_private.voice_floors(session_id) values(s.id) on conflict do nothing;
  if p_action='voice-invite' then return jsonb_build_object('sessionId',s.id,'state','invited','transport','NOT_RUN');end if;
  -- Separate broadcast room, but the administrator first preempts every floor.
  p:=jsonb_build_object('sessionId',s.id,'requestId',p->>'requestId');
  p_action:='floor-prepare';
 elsif p_action in ('voice-join','daily-receive','relay-receive') then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
  if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
  if p_action='voice-join' then
   insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
  end if;
  select * into member from navrang_private.voice_members where session_id=s.id and duty_id=d.id;
  if not found then return jsonb_build_object('error','Join the voice session first.','status',403);end if;
  perform navrang_private.voice_expire();
  checked_at:=clock_timestamp();
  if s.kind='channel' then
   -- The caller keeps polling its base channel. Only an authorized broadcast
   -- can redirect that receive connection; private invitations stay explicit.
   select broadcast.* into prior from navrang_private.voice_sessions broadcast
    join navrang_private.voice_floors floors on floors.session_id=broadcast.id
    join navrang_private.voice_duty owner_duty on owner_duty.id=floors.duty_id
    where broadcast.kind='broadcast' and broadcast.state='active'
     and floors.phase in ('active','granting') and floors.expires_at>checked_at
     and owner_duty.active and owner_duty.expires_at>checked_at
     and navrang_private.resolve_actor(owner_duty.session_hash)->>'admin'='true'
     and navrang_private.voice_allowed(actor,broadcast.audience,broadcast.owner_principal)
    order by broadcast.created_at desc,broadcast.id limit 1;
   if found then
    select * into s from navrang_private.voice_sessions where id=prior.id;
    if p_action<>'relay-receive' then
     insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
     select * into member from navrang_private.voice_members where session_id=s.id and duty_id=d.id;
    end if;
   end if;
  end if;
  select * into f from navrang_private.voice_floors where session_id=s.id;
  return jsonb_build_object('state',case when f.phase='active' and f.expires_at>checked_at and f.daily_plan is not null
    then case when f.identity=member.identity then 'speaking' else 'listening' end else 'idle' end,
   'dutyId',d.id,'sessionId',s.id,'room',s.room,'identity',member.identity,
   'plan',case when f.phase='active' and f.expires_at>checked_at then f.daily_plan else null end,
   'serverTime',floor(extract(epoch from checked_at)*1000),'dutyExpiresAt',d.expires_at,'canPublish',false,'transport','NOT_RUN');
 end if;
 if p_action in ('daily-plan','daily-commit','relay-plan','relay-commit','floor-commit','floor-fail','relay-operation') then
  if p_action='relay-operation' and (p - array['operationId','generation','sessionId'] <> '{}'::jsonb
   or jsonb_typeof(p->'generation') is distinct from 'number'
   or p->>'operationId' is null or p->>'sessionId' is null) then
   return jsonb_build_object('error','Exact relay operation identity required.','status',400);
  end if;
  select floors.* into f from navrang_private.voice_floors floors where operation_id=(p->>'operationId')::uuid and principal=principal_key
   and (phase='granting' or (p_action='relay-operation' and phase='active'));
  if not found or f.principal<>principal_key or f.generation is distinct from (p->>'generation')::bigint
   or (f.phase<>'granting' and not(p_action='relay-operation' and f.phase='active')) or f.expires_at<=checked_at then return jsonb_build_object('error','Floor operation is stale.','status',409);end if;
  select * into d from navrang_private.voice_duty where id=f.duty_id and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  select * into s from navrang_private.voice_sessions where id=f.session_id and state='active';
  if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
  if p_action='relay-operation' then
   -- Inspect the exact saved operation for staged commit/retry. Never prepare a
   -- successor, expire state, insert membership, or mint provider credentials.
   if f.session_id is distinct from (p->>'sessionId')::uuid
    or (f.daily_plan is not null and f.daily_plan->>'provider' is distinct from 'navrang-relay-v1') then
    return jsonb_build_object('error','Current relay operation required.','status',409);
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'operationId',operation_id,'room',room,'identity',identity,
    'generation',generation,'plan',daily_plan) order by id),'[]'::jsonb) into revokes
    from navrang_private.voice_commands where operation_id=f.operation_id and operation='revoke';
   return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',f.session_id,'dutyId',f.duty_id,'room',s.room,
    'identity',f.identity,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'plan',f.daily_plan,'revoke',revokes,
    'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
  end if;
  if p_action in ('daily-plan','relay-plan') then
   plan:=p->'plan';
   if jsonb_typeof(plan) is distinct from 'object'
    or plan - (case when p_action='relay-plan' then array['provider','leaseId','publisherIdentity','generation','roomId','origin','expiresAt']
      else array['provider','leaseId','publisherIdentity','generation','roomId','roomUrl','expiresAt'] end)<>'{}'::jsonb
    or (plan->>'leaseId'=f.lease_id::text and plan->>'publisherIdentity'=f.identity::text
     and jsonb_typeof(plan->'generation')='number' and plan->>'generation'=f.generation::text
     and case when p_action='relay-plan' then plan->>'provider'='navrang-relay-v1'
      and plan->>'roomId'='nr_'||replace(f.lease_id::text,'-','')
      and plan->>'origin' ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and plan->>'origin' like 'https://%.%'
      and plan->>'origin' !~ '^https://[0-9.]+$'
     else plan->>'provider'='daily' and plan->>'roomId' ~ '^nv_[0-9a-f]{32}$'
      and plan->>'roomUrl' ~ ('^https://[a-z0-9-]+[.]daily[.]co/' || (plan->>'roomId') || '$') end) is distinct from true then
    return jsonb_build_object('error','Invalid immutable provider room plan.','status',400);
   end if;
   plan_expiry:=(plan->>'expiresAt')::timestamptz;
   if plan_expiry is null or not isfinite(plan_expiry) or plan_expiry<=checked_at or plan_expiry>f.expires_at
    or plan_expiry>checked_at+interval '15 seconds' or extract(epoch from plan_expiry)<>floor(extract(epoch from plan_expiry)) then
    return jsonb_build_object('error','Daily room deadline must fit the current floor lease.','status',409);
   end if;
   if f.daily_plan is not null and f.daily_plan is distinct from plan then
    return jsonb_build_object('error','Daily room plan is immutable.','status',409);
   end if;
   if exists(select 1 from navrang_private.voice_commands where operation='grant' and daily_plan->>'roomId'=plan->>'roomId' and operation_id<>f.operation_id) then
    return jsonb_build_object('error','Daily room name has already been reserved.','status',409);
   end if;
   update navrang_private.voice_commands set daily_plan=plan where operation_id=f.operation_id and operation='grant' and state='pending';
   if not found then return jsonb_build_object('error','Grant command is stale.','status',409);end if;
   update navrang_private.voice_floors set daily_plan=plan,expires_at=plan_expiry where session_id=f.session_id returning * into f;
   return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',f.session_id,'dutyId',f.duty_id,'identity',f.identity,
    'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'plan',f.daily_plan,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
  elsif p_action in ('daily-commit','relay-commit') then
   plan:=p->'plan';receipt:=p->'receipt';
   if f.daily_plan is null or f.daily_plan is distinct from plan
    or ((case when p_action='relay-commit' then
      plan->>'provider'='navrang-relay-v1' and receipt->>'provider'='navrang-relay-v1'
      and jsonb_typeof(receipt)='object'
      and receipt - array['provider','prepared','grantId','epoch','mediaTerminationVerified','roomId','leaseId','generation','expiresAt']='{}'::jsonb
      and receipt->'prepared'='true'::jsonb and receipt->>'grantId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof(receipt->'epoch')='number' and (receipt->>'epoch')::numeric between 1 and 4294967295
      and (receipt->>'epoch')::numeric=trunc((receipt->>'epoch')::numeric)
     else plan->>'provider'='daily' and receipt->>'provider'='daily' and receipt->'grantVerified'='true'::jsonb end)
     and receipt->'mediaTerminationVerified'='true'::jsonb
     and receipt->>'roomId'=plan->>'roomId' and receipt->>'leaseId'=plan->>'leaseId'
     and receipt->'generation'=plan->'generation' and receipt->>'expiresAt'=plan->>'expiresAt') is distinct from true
    or exists(select 1 from navrang_private.voice_commands where operation_id=f.operation_id and operation='revoke' and state<>'acked') then
    return jsonb_build_object('error','Exact verified Daily grant and prior removals required.','status',409);
   end if;
   update navrang_private.voice_commands set state='acked',acked_at=checked_at where operation_id=f.operation_id and operation='grant' and state='pending' and daily_plan=plan;
   if not found then return jsonb_build_object('error','Grant command is stale.','status',409);end if;
   update navrang_private.voice_floors set phase='active' where session_id=f.session_id returning * into f;
   return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',f.session_id,'dutyId',f.duty_id,'identity',f.identity,
    'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'plan',f.daily_plan,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
  elsif p_action='floor-commit' and (f.daily_plan is not null or exists(select 1 from navrang_private.voice_commands where operation_id=f.operation_id and daily_plan is not null)) then
   return jsonb_build_object('error','Daily operations require exact room receipts.','status',409);
  end if;
  update navrang_private.voice_commands set state=case when p_action='floor-commit' then 'acked'
   when operation='grant' and not coalesce((p->>'ambiguousGrant')::boolean,false) then 'acked' else 'failed' end,
   acked_at=case when p_action='floor-commit' then checked_at end where operation_id=f.operation_id;
  if p_action='floor-commit' then
   update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null,daily_plan=null
   where operation_id=f.operation_id and session_id<>f.session_id and phase='revoking';
  end if;
  update navrang_private.voice_floors set phase=case when p_action='floor-commit' then 'active' else 'revoking' end where session_id=f.session_id returning * into f;
  if p_action='floor-fail' then
   if f.daily_plan is not null then
    -- Rotation may already have a revoke for the same member's OLD room in
    -- this operation. Give uncertain NEW-room cleanup its own command key.
    op:=gen_random_uuid();
    update navrang_private.voice_floors set operation_id=op,generation=generation+1 where session_id=f.session_id returning * into f;
   end if;
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation,daily_plan)
   select f.operation_id,f.session_id,room,f.identity,f.generation,'revoke',f.daily_plan from navrang_private.voice_sessions where id=f.session_id on conflict do nothing;
   update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
  end if;
  return jsonb_build_object('state',f.phase,'sessionId',f.session_id,'dutyId',f.duty_id,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
 end if;
 select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
 if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
 select members.* into member from navrang_private.voice_members members join navrang_private.voice_duty duty on duty.id=members.duty_id
 where members.session_id=s.id and duty.principal=principal_key and duty.session_hash=p_token and duty.active and duty.expires_at>checked_at order by duty.expires_at desc limit 1;
 if not found then return jsonb_build_object('error','Join the voice session first.','status',403);end if;
 select * into f from navrang_private.voice_floors where session_id=s.id for update;
 if p_action in ('floor-prepare','daily-renew-prepare','relay-renew-prepare') then
  if p_action in ('daily-renew-prepare','relay-renew-prepare') and (f.request_id=(p->>'requestId')::uuid and f.principal=principal_key and f.phase in ('active','granting')) is distinct from true then
   if f.daily_plan is null or f.daily_plan->>'provider'<>(case when p_action='relay-renew-prepare' then 'navrang-relay-v1' else 'daily' end)
    or f.phase<>'active' or f.principal<>principal_key or f.duty_id<>member.duty_id
    or f.lease_id is distinct from (p->>'leaseId')::uuid or f.expires_at<=checked_at then
    return jsonb_build_object('error','Current Daily floor lease required.','status',409);
   end if;
  end if;
  if exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state='active' and id<>s.id) then return jsonb_build_object('error','Administrator broadcast has priority.','status',409);end if;
  if f.request_id=(p->>'requestId')::uuid and f.principal=principal_key and f.phase in ('active','granting') then
   if f.expires_at<=checked_at then return jsonb_build_object('error','Floor request expired.','status',409);end if;
  else
   if f.phase in ('revoking','granting') then return jsonb_build_object('error','Previous floor operation awaits relay confirmation.','status',409);end if;
   if f.phase='active' and f.expires_at>checked_at and actor->>'admin'<>'true' and p_action not in ('daily-renew-prepare','relay-renew-prepare') then return jsonb_build_object('error','Another staff member is speaking.','status',409);end if;
   op:=gen_random_uuid();
   for prior in select floors.*,sessions.room from navrang_private.voice_floors floors join navrang_private.voice_sessions sessions on sessions.id=floors.session_id
    where floors.phase<>'idle' and (floors.session_id=s.id or (s.kind='broadcast' and actor->>'admin'='true'))
   loop
    insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation,daily_plan)
    values(op,prior.session_id,prior.room,prior.identity,prior.generation+1,'revoke',prior.daily_plan);
    update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=prior.session_id;
   end loop;
   update navrang_private.voice_floors set generation=generation+1,phase='granting',principal=principal_key,identity=member.identity,duty_id=member.duty_id,
    lease_id=gen_random_uuid(),expires_at=checked_at+interval '15 seconds',operation_id=op,request_id=(p->>'requestId')::uuid,daily_plan=null where session_id=s.id returning * into f;
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation) values(op,s.id,s.room,member.identity,f.generation,'grant');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'operationId',operation_id,'room',room,'identity',identity,'generation',generation,'plan',daily_plan) order by id),'[]'::jsonb) into revokes from navrang_private.voice_commands where operation_id=f.operation_id and operation='revoke';
  return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',s.id,'dutyId',f.duty_id,'room',s.room,'identity',member.identity,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'plan',f.daily_plan,'revoke',revokes,'serverTime',floor(extract(epoch from checked_at)*1000),'transport','NOT_RUN');
 elsif p_action='voice-renew' then
  if f.daily_plan is not null then return jsonb_build_object('error','Daily renewal requires a new immutable room.','status',409);end if;
  if f.phase<>'active' or f.principal<>principal_key or f.duty_id<>member.duty_id or f.lease_id is distinct from (p->>'leaseId')::uuid or f.expires_at<=checked_at then return jsonb_build_object('error','Floor lease expired.','status',409);end if;
  update navrang_private.voice_floors set expires_at=checked_at+interval '15 seconds' where session_id=s.id returning * into f;
  return jsonb_build_object('state',f.phase,'leaseId',f.lease_id,'expiresAt',f.expires_at,'generation',f.generation);
 elsif p_action in ('voice-release','voice-broadcast-end') then
  if p_action='voice-broadcast-end' and (actor->>'admin'<>'true' or s.kind<>'broadcast') then return jsonb_build_object('error','Administrator broadcast required.','status',403);end if;
  if f.phase='idle' then
   if p_action='voice-broadcast-end' then update navrang_private.voice_sessions set state='ending' where id=s.id;perform navrang_private.voice_expire();end if;
   return jsonb_build_object('state','idle');
  end if;
  if f.principal<>principal_key or (p_action='voice-release' and f.lease_id is distinct from (p->>'leaseId')::uuid) then return jsonb_build_object('error','Floor belongs to another session.','status',403);end if;
  if f.phase='granting' then
   update navrang_private.voice_commands set state='failed' where operation_id=f.operation_id and operation='grant' and state='pending';
  end if;
  op:=gen_random_uuid();update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=s.id returning * into f;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation,daily_plan) values(op,s.id,s.room,f.identity,f.generation,'revoke',f.daily_plan);
  if p_action='voice-broadcast-end' then update navrang_private.voice_sessions set state='ending' where id=s.id;perform navrang_private.voice_expire();end if;
  return jsonb_build_object('state','revoking','operationId',op,'transport','NOT_RUN');
 end if;
 return jsonb_build_object('error','Unknown voice action.','status',400);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('error','Invalid voice identifiers.','status',400);
end;
$voice$;
revoke all on function navrang_private.voice_rpc(text,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.voice_rpc(text,jsonb,text) to service_role;
