-- Select this mode only for an environment using the immutable Cloudflare
-- relay after establishing that no legacy room credentials can still exist.
begin;
alter table navrang_private.voice_runtime
 add column if not exists immutable_relay_only boolean not null default false;

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
  -- In immutable relay mode an idle floor has no receive credential or live
  -- provider room. Pending removals still require their original proof.
  if f.phase='idle' and f.daily_plan is null and
   (select immutable_relay_only from navrang_private.voice_runtime where singleton) then
   delete from navrang_private.voice_members where identity=f.identity;
   continue;
  end if;
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

commit;
