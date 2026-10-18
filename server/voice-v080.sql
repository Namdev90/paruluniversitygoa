-- Additive, private voice state preparation. Apply after communications-v080.sql.
-- No relay credentials/tokens are stored or minted. Transport remains NOT_RUN.
-- A separately deployed one-second authenticated worker must enforce expiration;
-- these SQL leases alone do NOT stop media at a relay.
create table if not exists navrang_private.voice_runtime (
 singleton boolean primary key default true check(singleton),
 configured boolean not null default false,revocation_verified boolean not null default false,
 revocation_mode text not null default 'disabled' check(revocation_mode in ('disabled','cloud-explicit-cutoff','guarded-admission')),
 worker_at timestamptz
);
insert into navrang_private.voice_runtime(singleton) values(true) on conflict do nothing;
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
 select coalesce((select configured and revocation_verified and revocation_mode in ('cloud-explicit-cutoff','guarded-admission')
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
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
  values(op,f.session_id,f.room,f.identity,f.generation+1,'revoke');
  update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
 end loop;
 -- Listening memberships also need authoritative removal after logout, role
 -- revocation or duty expiry, even if that member never held a speaking floor.
 for f in select m.session_id,m.identity,s.room,floors.generation
 from navrang_private.voice_members m join navrang_private.voice_duty d on d.id=m.duty_id
 join navrang_private.voice_sessions s on s.id=m.session_id
 join navrang_private.voice_floors floors on floors.session_id=s.id
 where (not d.active or d.expires_at<=checked_at or s.state<>'active' or
  not navrang_private.voice_allowed(navrang_private.resolve_actor(d.session_hash),s.audience,s.owner_principal))
 and not exists(select 1 from navrang_private.voice_commands commands where commands.identity=m.identity
  and commands.operation='revoke' and commands.state in ('pending','failed'))
 loop
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
  values(gen_random_uuid(),f.session_id,f.room,f.identity,f.generation,'revoke');
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'operationId',operation_id,'sessionId',session_id,'room',room,'identity',identity,'generation',generation,'operation',operation) order by created_at,id),'[]'::jsonb)
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
 update navrang_private.voice_commands set state='acked',acked_at=clock_timestamp() where id=p_command;
 delete from navrang_private.voice_members members where members.identity=command.identity
 and not exists(select 1 from navrang_private.voice_floors floors where floors.identity=members.identity and floors.phase in ('active','granting'));
 if not exists(select 1 from navrang_private.voice_commands where operation_id=command.operation_id and operation='revoke' and state<>'acked') then
  update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null
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
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 then return jsonb_build_object('error','Invalid voice payload.','status',400);end if;
 actor:=navrang_private.resolve_actor(p_token);
 if actor ? 'error' then return actor;end if;
 if not navrang_private.voice_allowed(actor,'{"type":"everyone"}','') then return jsonb_build_object('error','Approved staff access required.','status',403);end if;
 principal_key:=actor->>'principal';
 -- All state mutations share one short database lock. Never hold it during HTTP.
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 if p_action not in ('duty-leave','voice-release','voice-broadcast-end','floor-fail') and not navrang_private.voice_ready() then
  return jsonb_build_object('error','Voice provider or expiry worker is not ready.','status',503);
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
  return jsonb_build_object('dutyId',d.id,'expiresAt',d.expires_at,'sessionId',s.id,'transport','NOT_RUN');
 elsif p_action in ('duty-heartbeat','duty-leave') then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token;
  if not found or not d.active or d.expires_at<=checked_at then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  update navrang_private.voice_duty set active=p_action<>'duty-leave',expires_at=case when p_action='duty-leave' then checked_at else checked_at+interval '60 seconds' end where id=d.id;
  if p_action='duty-leave' then perform navrang_private.voice_expire();end if;
  return jsonb_build_object('dutyId',d.id,'active',p_action<>'duty-leave','transport','NOT_RUN');
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
 elsif p_action='voice-join' then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
  if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
  insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
  select * into member from navrang_private.voice_members where session_id=s.id and duty_id=d.id;
  return jsonb_build_object('sessionId',s.id,'room',s.room,'identity',member.identity,'canPublish',false,'transport','NOT_RUN');
 end if;
 if p_action in ('floor-commit','floor-fail') then
  select floors.* into f from navrang_private.voice_floors floors where operation_id=(p->>'operationId')::uuid and principal=principal_key and phase='granting';
  if not found or f.principal<>principal_key or f.generation is distinct from (p->>'generation')::bigint or f.phase<>'granting' or f.expires_at<=checked_at then return jsonb_build_object('error','Floor operation is stale.','status',409);end if;
  select * into d from navrang_private.voice_duty where id=f.duty_id and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  update navrang_private.voice_commands set state=case when p_action='floor-commit' then 'acked'
   when operation='grant' and not coalesce((p->>'ambiguousGrant')::boolean,false) then 'acked' else 'failed' end,
   acked_at=case when p_action='floor-commit' then checked_at end where operation_id=f.operation_id;
  if p_action='floor-commit' then
   update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null
   where operation_id=f.operation_id and session_id<>f.session_id and phase='revoking';
  end if;
  update navrang_private.voice_floors set phase=case when p_action='floor-commit' then 'active' else 'revoking' end where session_id=f.session_id returning * into f;
  if p_action='floor-fail' then
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
   select f.operation_id,f.session_id,room,f.identity,f.generation,'revoke' from navrang_private.voice_sessions where id=f.session_id on conflict do nothing;
   update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
  end if;
  return jsonb_build_object('state',f.phase,'sessionId',f.session_id,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'transport','NOT_RUN');
 end if;
 select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
 if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
 select members.* into member from navrang_private.voice_members members join navrang_private.voice_duty duty on duty.id=members.duty_id
 where members.session_id=s.id and duty.principal=principal_key and duty.session_hash=p_token and duty.active and duty.expires_at>checked_at order by duty.expires_at desc limit 1;
 if not found then return jsonb_build_object('error','Join the voice session first.','status',403);end if;
 select * into f from navrang_private.voice_floors where session_id=s.id for update;
 if p_action='floor-prepare' then
  if exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state='active' and id<>s.id) then return jsonb_build_object('error','Administrator broadcast has priority.','status',409);end if;
  if f.request_id=(p->>'requestId')::uuid and f.principal=principal_key and f.phase in ('active','granting') then
   if f.expires_at<=checked_at then return jsonb_build_object('error','Floor request expired.','status',409);end if;
  else
   if f.phase in ('revoking','granting') then return jsonb_build_object('error','Previous floor operation awaits relay confirmation.','status',409);end if;
   if f.phase='active' and f.expires_at>checked_at and actor->>'admin'<>'true' then return jsonb_build_object('error','Another staff member is speaking.','status',409);end if;
   op:=gen_random_uuid();
   for prior in select floors.*,sessions.room from navrang_private.voice_floors floors join navrang_private.voice_sessions sessions on sessions.id=floors.session_id
    where floors.phase<>'idle' and (floors.session_id=s.id or (s.kind='broadcast' and actor->>'admin'='true'))
   loop
    insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
    values(op,prior.session_id,prior.room,prior.identity,prior.generation+1,'revoke');
    update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=prior.session_id;
   end loop;
   update navrang_private.voice_floors set generation=generation+1,phase='granting',principal=principal_key,identity=member.identity,duty_id=member.duty_id,
    lease_id=gen_random_uuid(),expires_at=checked_at+interval '15 seconds',operation_id=op,request_id=(p->>'requestId')::uuid where session_id=s.id returning * into f;
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation) values(op,s.id,s.room,member.identity,f.generation,'grant');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('room',room,'identity',identity,'generation',generation) order by id),'[]'::jsonb) into revokes from navrang_private.voice_commands where operation_id=f.operation_id and operation='revoke';
  return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',s.id,'room',s.room,'identity',member.identity,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'revoke',revokes,'transport','NOT_RUN');
 elsif p_action='voice-renew' then
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
  op:=gen_random_uuid();update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=s.id returning * into f;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation) values(op,s.id,s.room,f.identity,f.generation,'revoke');
  if p_action='voice-broadcast-end' then update navrang_private.voice_sessions set state='ending' where id=s.id;perform navrang_private.voice_expire();end if;
  return jsonb_build_object('state','revoking','operationId',op,'transport','NOT_RUN');
 end if;
 return jsonb_build_object('error','Unknown voice action.','status',400);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','Invalid voice identifiers.','status',400);
end;
$voice$;
revoke all on function navrang_private.voice_rpc(text,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.voice_rpc(text,jsonb,text) to service_role;
