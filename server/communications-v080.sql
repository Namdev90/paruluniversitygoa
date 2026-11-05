-- Navrang 0.8.0: additive service-only communications foundation.
-- Apply transactionally after the reviewed 0.7.9 schema. Existing gate/report
-- function bodies and their grants are deliberately not replaced by this file.
create sequence if not exists navrang_private.communication_capability_revision_seq as bigint;
create table if not exists navrang_private.communication_capability_revisions (
 principal text primary key check(principal='admin' or principal ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 revision bigint not null default nextval('navrang_private.communication_capability_revision_seq'::regclass) check(revision>0),
 changed_at timestamptz not null default clock_timestamp()
);
alter sequence navrang_private.communication_capability_revision_seq owned by navrang_private.communication_capability_revisions.revision;
alter table navrang_private.communication_capability_revisions enable row level security;
revoke all on navrang_private.communication_capability_revisions from public,anon,authenticated;
revoke all on sequence navrang_private.communication_capability_revision_seq from public,anon,authenticated;
grant select,insert,update on navrang_private.communication_capability_revisions to service_role;
grant usage,select on sequence navrang_private.communication_capability_revision_seq to service_role;

insert into navrang_private.communication_capability_revisions(principal)
 select 'admin' union all select id::text from navrang_private.checkers
on conflict(principal) do nothing;

create or replace function navrang_private.bump_communication_capability(p_principal text)
returns bigint language plpgsql security invoker set search_path='' as $capability$
declare next_revision bigint;
begin
 insert into navrang_private.communication_capability_revisions as revisions(principal,revision,changed_at)
 values(p_principal,nextval('navrang_private.communication_capability_revision_seq'::regclass),clock_timestamp())
 on conflict(principal) do update set revision=excluded.revision,changed_at=excluded.changed_at
 returning revisions.revision into next_revision;
 return next_revision;
end;
$capability$;
revoke all on function navrang_private.bump_communication_capability(text) from public,anon,authenticated;
grant execute on function navrang_private.bump_communication_capability(text) to service_role;

create or replace function navrang_private.communication_checker_capability_changed()
returns trigger language plpgsql security invoker set search_path='' as $capability$
begin
 if tg_op='UPDATE' and
    row(old.id,old.name,old.method,old.google_id,old.active,old.name_confirmed,old.scanner_enabled,old.helpdesk_enabled,old.selected_station,old.access_expires_at)
    is not distinct from
    row(new.id,new.name,new.method,new.google_id,new.active,new.name_confirmed,new.scanner_enabled,new.helpdesk_enabled,new.selected_station,new.access_expires_at) then
  return new;
 end if;
 if tg_op='DELETE' then
  perform navrang_private.bump_communication_capability(old.id::text);
  return old;
 end if;
 if tg_op='UPDATE' and old.id is distinct from new.id then
  perform navrang_private.bump_communication_capability(old.id::text);
 end if;
 perform navrang_private.bump_communication_capability(new.id::text);
 return new;
end;
$capability$;
revoke all on function navrang_private.communication_checker_capability_changed() from public,anon,authenticated;
grant execute on function navrang_private.communication_checker_capability_changed() to service_role;
drop trigger if exists navrang_communication_checker_capability on navrang_private.checkers;
create trigger navrang_communication_checker_capability
 after insert or update or delete on navrang_private.checkers
 for each row execute function navrang_private.communication_checker_capability_changed();

create or replace function navrang_private.communication_report_capability_changed()
returns trigger language plpgsql security invoker set search_path='' as $capability$
begin
 if tg_op='UPDATE' and old.checker_id is not distinct from new.checker_id and
    old.enabled is not distinct from new.enabled then return new;end if;
 if tg_op='DELETE' then
  perform navrang_private.bump_communication_capability(old.checker_id::text);
  return old;
 end if;
 if tg_op='UPDATE' and old.checker_id is distinct from new.checker_id then
  perform navrang_private.bump_communication_capability(old.checker_id::text);
 end if;
 perform navrang_private.bump_communication_capability(new.checker_id::text);
 return new;
end;
$capability$;
revoke all on function navrang_private.communication_report_capability_changed() from public,anon,authenticated;
grant execute on function navrang_private.communication_report_capability_changed() to service_role;
drop trigger if exists navrang_communication_report_capability on navrang_private.report_grants;
create trigger navrang_communication_report_capability
 after insert or update or delete on navrang_private.report_grants
 for each row execute function navrang_private.communication_report_capability_changed();

-- This is an identity/capability lookup, not a login endpoint. p_token is the
-- SHA-256 hash of the opaque Navrang bearer supplied by the trusted Edge server.
create or replace function navrang_private.resolve_actor(p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $actor$
declare
 session_row navrang_private.sessions%rowtype;
 staff navrang_private.checkers%rowtype;
 principal_key text; capability_revision bigint; report_enabled boolean:=false;
 active_account boolean:=false; name_ready boolean:=false;
 effective_scanner boolean:=false; effective_helpdesk boolean:=false; effective_faculty boolean:=false;
 checked_at timestamptz:=clock_timestamp();
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('error','Sign in again.','status',401);
 end if;
 select * into session_row from navrang_private.sessions where hash=p_token and expires_at>checked_at;
 if not found then return jsonb_build_object('error','Sign in again.','status',401);end if;
 if session_row.role='admin' then
  principal_key:='admin';active_account:=true;
 elsif session_row.role='checker' then
  select * into staff from navrang_private.checkers where id=session_row.checker_id;
  if not found or (staff.access_expires_at is not null and staff.access_expires_at<=checked_at) then
   return jsonb_build_object('error','Staff access expired. Sign in again.','status',401);
  end if;
  principal_key:=staff.id::text;active_account:=staff.active;
  name_ready:=staff.method<>'google' or staff.name_confirmed;
  effective_scanner:=active_account and name_ready and staff.scanner_enabled and staff.selected_station='checker';
  effective_helpdesk:=active_account and name_ready and staff.helpdesk_enabled and staff.selected_station='helpdesk';
  select coalesce(enabled,false) into report_enabled from navrang_private.report_grants where checker_id=staff.id;
  effective_faculty:=active_account and staff.method='google' and staff.google_id is not null and staff.name_confirmed
   and not staff.scanner_enabled and not staff.helpdesk_enabled and coalesce(report_enabled,false);
 else
  return jsonb_build_object('error','Sign in again.','status',401);
 end if;
 select revision into capability_revision from navrang_private.communication_capability_revisions where principal=principal_key;
 if not found then return jsonb_build_object('error','Communication access is not ready.','status',503);end if;
 return jsonb_build_object('principal',principal_key,'admin',session_row.role='admin','scanner',effective_scanner,
  'helpdesk',effective_helpdesk,'faculty',effective_faculty,'active',active_account,'capabilityRevision',capability_revision);
end;
$actor$;
revoke all on function navrang_private.resolve_actor(text) from public,anon,authenticated;
grant execute on function navrang_private.resolve_actor(text) to service_role;

-- The RPC lives in the exposed schema for the existing service-authenticated
-- PostgREST transport. Its EXECUTE grant remains exclusively server-side.
create or replace function public.navrang_communications(p_action text,p jsonb default '{}'::jsonb,p_token text default '')
returns jsonb language plpgsql security invoker set search_path='' as $communications$
declare actor jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 then
  return jsonb_build_object('error','Invalid communication payload.','status',400);
 end if;
 if p_action is null or p_action not in (
  'capabilities','notifications-feed','notifications-read','notifications-dashboard','notifications-preview',
  'notifications-send','notifications-end','notifications-device','notifications-unregister',
  'duty-join','duty-heartbeat','duty-leave','voice-join','voice-floor','voice-renew','voice-release',
  'voice-broadcast-start','voice-broadcast-end','voice-invite'
 ) then return jsonb_build_object('error','Unknown communication action.','status',400);end if;
 if p_action='capabilities' and p<>'{}'::jsonb then
  return jsonb_build_object('error','Capability lookup does not accept account or permission fields.','status',400);
 end if;
 if p_action like 'notifications-%' then
  if to_regprocedure('navrang_private.notification_rpc(text,jsonb,text)') is null then
   return jsonb_build_object('error','Notification center is not configured.','status',503);
  end if;
  -- The private helper rechecks identity/capabilities, including its deliberately
  -- narrow proof-only unlink and own access-change feed for revoked staff.
  return navrang_private.notification_rpc(p_action,p,p_token);
 end if;
 actor:=navrang_private.resolve_actor(p_token);
 if actor ? 'error' then return actor;end if;
 if p_action='capabilities' then return actor;end if;
 if actor->>'active'<>'true' then
  return jsonb_build_object('error','Administrator approval is required.','status',403);
 end if;
 -- No disabled adapter is presented as working delivery or voice. Later reviewed
 -- steps replace these branches only after their transport acceptance gates.
 return jsonb_build_object('error','Communications are not configured yet.','status',503);
end;
$communications$;
revoke all on function public.navrang_communications(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_communications(text,jsonb,text) to service_role;
