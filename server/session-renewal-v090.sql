-- Reviewed local preparation: apply transactionally after the v0.8 schemas.
-- Legacy clients keep their existing session policy. No client table/RPC grant.
create table if not exists navrang_private.session_families(
 id uuid primary key default gen_random_uuid(),
 role text not null check(role in ('admin','checker')),
 checker_id uuid references navrang_private.checkers(id) on delete cascade,
 installation_id text not null check(installation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 created_at timestamptz not null,absolute_expires_at timestamptz not null,idle_expires_at timestamptz not null,
 revoked_at timestamptz,revocation_reason text,
 check((role='admin' and checker_id is null) or (role='checker' and checker_id is not null)),
 check(idle_expires_at<=absolute_expires_at)
);
create table if not exists navrang_private.session_refresh_tokens(
 hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
 family_id uuid not null references navrang_private.session_families(id) on delete cascade,
 created_at timestamptz not null,consumed_at timestamptz,request_id uuid,next_hash text,
 check((consumed_at is null and request_id is null and next_hash is null) or
       (consumed_at is not null and request_id is not null and next_hash ~ '^[a-f0-9]{64}$'))
);
create index if not exists session_families_expiry on navrang_private.session_families(idle_expires_at,absolute_expires_at);
create index if not exists session_refresh_family on navrang_private.session_refresh_tokens(family_id);
alter table navrang_private.sessions add column if not exists family_id uuid references navrang_private.session_families(id) on delete cascade;
create index if not exists sessions_family on navrang_private.sessions(family_id);
alter table navrang_private.session_families enable row level security;
alter table navrang_private.session_refresh_tokens enable row level security;
revoke all on navrang_private.session_families,navrang_private.session_refresh_tokens from public,anon,authenticated;
grant select,insert,update,delete on navrang_private.session_families,navrang_private.session_refresh_tokens to service_role;

create or replace function navrang_private.revoke_session_family(p_family uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $revoke$
begin
 update navrang_private.session_families set revoked_at=coalesce(revoked_at,clock_timestamp()),
  revocation_reason=coalesce(revocation_reason,left(p_reason,40)) where id=p_family;
 delete from navrang_private.sessions where family_id=p_family;
end;
$revoke$;
revoke all on function navrang_private.revoke_session_family(uuid,text) from public,anon,authenticated;
grant execute on function navrang_private.revoke_session_family(uuid,text) to service_role;

create or replace function navrang_private.session_family_deadline_changed()
returns trigger language plpgsql security invoker set search_path='' as $deadline$
begin
 if new.revoked_at is not null then delete from navrang_private.sessions where family_id=new.id;
 else update navrang_private.sessions set expires_at=least(expires_at,new.idle_expires_at,new.absolute_expires_at) where family_id=new.id;end if;
 return new;
end;
$deadline$;
revoke all on function navrang_private.session_family_deadline_changed() from public,anon,authenticated;
grant execute on function navrang_private.session_family_deadline_changed() to service_role;
drop trigger if exists navrang_session_family_deadline on navrang_private.session_families;
create trigger navrang_session_family_deadline after update of revoked_at,idle_expires_at,absolute_expires_at on navrang_private.session_families for each row execute function navrang_private.session_family_deadline_changed();

create or replace function navrang_private.session_account_revoked()
returns trigger language plpgsql security invoker set search_path='' as $account$
declare family record;
begin
 if tg_table_name='checkers' then
  if not(old.active and not new.active) and not(new.access_expires_at is not null and new.access_expires_at<=clock_timestamp()) then return new;end if;
  for family in select id from navrang_private.session_families where checker_id=new.id and revoked_at is null order by id loop
   perform navrang_private.revoke_session_family(family.id,'account-revoked');
  end loop;
 else
  if row(old.salt,old.hash) is not distinct from row(new.salt,new.hash) then return new;end if;
  for family in select id from navrang_private.session_families where role='admin' and revoked_at is null order by id loop
   perform navrang_private.revoke_session_family(family.id,'password-changed');
  end loop;
 end if;
 return new;
end;
$account$;
revoke all on function navrang_private.session_account_revoked() from public,anon,authenticated;
grant execute on function navrang_private.session_account_revoked() to service_role;
drop trigger if exists navrang_session_checker_revoked on navrang_private.checkers;
create trigger navrang_session_checker_revoked after update of active,access_expires_at on navrang_private.checkers for each row execute function navrang_private.session_account_revoked();
drop trigger if exists navrang_session_admin_password on navrang_private.admin_credentials;
create trigger navrang_session_admin_password after update of salt,hash on navrang_private.admin_credentials for each row execute function navrang_private.session_account_revoked();

create or replace function navrang_private.rebind_session_dependents(p_family uuid,p_new_hash text,p_principal text)
returns void language plpgsql security invoker set search_path='' as $rebind$
begin
 -- Same logical family only. Do this before deleting old access rows so that
 -- refresh does not unlink private push, voice duty or pending report receipts.
 if to_regclass('navrang_private.notification_devices') is not null then
  execute 'update navrang_private.notification_devices set session_hash=$1 where principal=$2 and session_hash in(select hash from navrang_private.sessions where family_id=$3 and hash<>$1)' using p_new_hash,p_principal,p_family;
 end if;
 if to_regclass('navrang_private.voice_duty') is not null then
  execute 'update navrang_private.voice_duty set session_hash=$1 where principal=$2 and session_hash in(select hash from navrang_private.sessions where family_id=$3 and hash<>$1)' using p_new_hash,p_principal,p_family;
 end if;
 if to_regclass('navrang_private.report_operations') is not null then
  execute 'update navrang_private.report_operations set session_hash=$1 where actor=$2 and session_hash in(select hash from navrang_private.sessions where family_id=$3 and hash<>$1)' using p_new_hash,p_principal,p_family;
 end if;
end;
$rebind$;
revoke all on function navrang_private.rebind_session_dependents(uuid,text,text) from public,anon,authenticated;
grant execute on function navrang_private.rebind_session_dependents(uuid,text,text) to service_role;

create or replace function navrang_private.prune_session_families()
returns bigint language plpgsql security invoker set search_path='' as $prune$
declare removed bigint;
begin
 delete from navrang_private.session_families where idle_expires_at<=clock_timestamp() or absolute_expires_at<=clock_timestamp() or revoked_at<clock_timestamp()-interval '24 hours';
 get diagnostics removed=row_count;return removed;
end;
$prune$;
revoke all on function navrang_private.prune_session_families() from public,anon,authenticated;
grant execute on function navrang_private.prune_session_families() to service_role;

do $compat$
begin
 if to_regprocedure('public.navrang_gate_before_renewal_v090(text,jsonb,text)') is null then
  alter function public.navrang_gate(text,jsonb,text) rename to navrang_gate_before_renewal_v090;
 end if;
end;
$compat$;
revoke all on function public.navrang_gate_before_renewal_v090(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_gate_before_renewal_v090(text,jsonb,text) to service_role;

create or replace function public.navrang_gate(p_action text,p jsonb default '{}'::jsonb,p_token text default '')
returns jsonb language plpgsql security invoker set search_path='' as $renew$
declare
 f navrang_private.session_families%rowtype; consumed navrang_private.session_refresh_tokens%rowtype;
 staff navrang_private.checkers%rowtype; candidate_family uuid; profile jsonb; deadline timestamptz;
 checked_at timestamptz; retry boolean:=false; principal text;
 invalid jsonb:='{"error":"Sign in again. Your session expired.","status":401}'::jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 and p_action in ('session-create','session-refresh','session-revoke') then
  return jsonb_build_object('error','Invalid session payload.','status',400);
 end if;
 if p_action='session-create' and p ? 'refreshHash' then
  if coalesce(p->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'refreshHash','') !~ '^[a-f0-9]{64}$' or p->>'hash'=p->>'refreshHash' or coalesce(p->>'installationId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' or coalesce(p->>'role','') not in ('admin','checker') then return jsonb_build_object('error','Invalid session protocol.','status',400);end if;
  profile:=public.navrang_gate_before_renewal_v090(p_action,p,p_token);
  if profile ? 'error' then return profile;end if;
  checked_at:=clock_timestamp();deadline:=checked_at+interval '30 days';
  if p->>'role'='checker' then
   select * into staff from navrang_private.checkers where id=(p->>'checkerId')::uuid;
   if not found or staff.access_expires_at<=checked_at then return invalid;end if;
   deadline:=least(deadline,coalesce(staff.access_expires_at,deadline));
  end if;
  insert into navrang_private.session_families(role,checker_id,installation_id,created_at,absolute_expires_at,idle_expires_at)
  values(p->>'role',case when p->>'role'='checker' then staff.id else null end,p->>'installationId',checked_at,deadline,least(checked_at+interval '7 days',deadline)) returning * into f;
  insert into navrang_private.session_refresh_tokens(hash,family_id,created_at) values(p->>'refreshHash',f.id,checked_at);
  update navrang_private.sessions set family_id=f.id,created_at=checked_at,expires_at=least(checked_at+interval '15 minutes',f.idle_expires_at,f.absolute_expires_at) where hash=p->>'hash' returning expires_at into deadline;
  return jsonb_build_object('profile',profile||jsonb_build_object('expiresAt',deadline),'refreshFamilyId',f.id,'refreshExpiresAt',f.idle_expires_at,'absoluteExpiresAt',f.absolute_expires_at);
 end if;
 if p_action in ('session-refresh','session-revoke') then
  if coalesce(p->>'refreshHash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'installationId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then return jsonb_build_object('error','Invalid session renewal.','status',400);end if;
  select family_id into candidate_family from navrang_private.session_refresh_tokens where hash=p->>'refreshHash';
  if not found then if p_action='session-revoke' then return jsonb_build_object('signedOut',true);else return invalid;end if;end if;
  -- Family before token is the uniform lock order, including prune/revocation.
  select * into f from navrang_private.session_families where id=candidate_family for update;
  if not found or f.installation_id<>p->>'installationId' then return invalid;end if;
  checked_at:=clock_timestamp();
  if p_action='session-revoke' then perform navrang_private.revoke_session_family(f.id,'logout');return jsonb_build_object('signedOut',true);end if;
  if f.revoked_at is not null then return invalid;end if;
  if f.idle_expires_at<=checked_at or f.absolute_expires_at<=checked_at then perform navrang_private.revoke_session_family(f.id,'expired');return invalid;end if;
  if f.role='checker' then
   select * into staff from navrang_private.checkers where id=f.checker_id;
   if not found or staff.access_expires_at<=checked_at then perform navrang_private.revoke_session_family(f.id,'access-expired');return invalid;end if;
  end if;
  if coalesce(p->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'nextRefreshHash','') !~ '^[a-f0-9]{64}$' or p->>'nextRefreshHash'=p->>'refreshHash' or coalesce(p->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return jsonb_build_object('error','Invalid session renewal.','status',400);end if;
  select * into consumed from navrang_private.session_refresh_tokens where hash=p->>'refreshHash' and family_id=f.id for update;
  if not found then return invalid;end if;
  if consumed.consumed_at is not null then
   if consumed.request_id=(p->>'requestId')::uuid and consumed.next_hash=p->>'nextRefreshHash' and consumed.consumed_at>checked_at-interval '30 seconds'
      and exists(select 1 from navrang_private.session_refresh_tokens where hash=consumed.next_hash and family_id=f.id and consumed_at is null) then retry:=true;
   else perform navrang_private.revoke_session_family(f.id,'refresh-reuse');return invalid;end if;
  else
   if exists(select 1 from navrang_private.session_refresh_tokens where hash=p->>'nextRefreshHash') then return jsonb_build_object('error','Invalid session renewal.','status',400);end if;
   update navrang_private.session_refresh_tokens set consumed_at=checked_at,request_id=(p->>'requestId')::uuid,next_hash=p->>'nextRefreshHash' where hash=consumed.hash;
   insert into navrang_private.session_refresh_tokens(hash,family_id,created_at) values(p->>'nextRefreshHash',f.id,checked_at);
   update navrang_private.session_families set idle_expires_at=least(checked_at+interval '7 days',absolute_expires_at,coalesce(staff.access_expires_at,absolute_expires_at)) where id=f.id returning * into f;
  end if;
  deadline:=least(checked_at+interval '15 minutes',f.idle_expires_at,f.absolute_expires_at,coalesce(staff.access_expires_at,f.absolute_expires_at));
  insert into navrang_private.sessions(hash,role,checker_id,created_at,expires_at,family_id) values(p->>'hash',f.role,f.checker_id,checked_at,deadline,f.id);
  principal:=case when f.role='admin' then 'admin' else f.checker_id::text end;
  perform navrang_private.rebind_session_dependents(f.id,p->>'hash',principal);
  delete from navrang_private.sessions where family_id=f.id and hash<>p->>'hash';
  profile:=public.navrang_gate_before_renewal_v090('me','{}',p->>'hash');
  if profile ? 'error' then perform navrang_private.revoke_session_family(f.id,'authorization-failed');return invalid;end if;
  return jsonb_build_object('profile',profile,'refreshFamilyId',f.id,'refreshExpiresAt',f.idle_expires_at,'absoluteExpiresAt',f.absolute_expires_at);
 end if;
 select family_id into candidate_family from navrang_private.sessions where hash=p_token;
 if candidate_family is not null then
  if p_action='logout' then perform navrang_private.revoke_session_family(candidate_family,'logout');return jsonb_build_object('signedOut',true);end if;
  select * into f from navrang_private.session_families where id=candidate_family;
  if not found or f.revoked_at is not null or f.idle_expires_at<=clock_timestamp() or f.absolute_expires_at<=clock_timestamp() then return invalid;end if;
 end if;
 return public.navrang_gate_before_renewal_v090(p_action,p,p_token);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','Invalid session renewal.','status',400);
end;
$renew$;
revoke all on function public.navrang_gate(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_gate(text,jsonb,text) to service_role;
