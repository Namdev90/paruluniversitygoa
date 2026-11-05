-- Proposed additive migration, NOT applied to production. Execute as one transaction
-- after review and hosted role/ownership feasibility checks. No credentials here.
-- Fail on any existing names rather than adopting unknown objects or permissions.
begin;
set local search_path=pg_catalog;
do $preflight$
begin
 if exists(select 1 from pg_catalog.pg_roles where rolname='navrang_notification_worker') then
  raise exception 'Notification capability role already exists; inspect before retry'; end if;
 if pg_catalog.to_regnamespace('navrang_notification_bridge') is not null then
  raise exception 'Notification API schema already exists; inspect before retry'; end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='service_role' and not rolcanlogin and rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication) then
  raise exception 'Existing service_role must be NOLOGIN, BYPASSRLS, and not have administrator attributes'; end if;
 if current_setting('server_version_num')::integer<160000 then
  raise exception 'Notification bridge requires PostgreSQL 16 or newer for ownership preflight'; end if;
 if not pg_catalog.pg_has_role(current_user,'service_role','SET') then
  raise exception 'Migration executor must be able to transfer wrapper ownership to service_role'; end if;
 if not pg_catalog.has_schema_privilege('service_role','navrang_private','USAGE') or exists(
  select 1 from (values
   ('claim_notification_deliveries','integer'),('check_notification_delivery','bigint, uuid'),
   ('finish_notification_delivery','bigint, uuid, text'),('resolve_actor','text')) required(name,args)
  where not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname='navrang_private' and p.proname=required.name
    and pg_catalog.oidvectortypes(p.proargtypes)=required.args
    and pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))) then
  raise exception 'Existing service_role cannot invoke the required private functions'; end if;
end;
$preflight$;

create role navrang_notification_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
create schema navrang_notification_bridge;
revoke all on schema navrang_notification_bridge from public,anon,authenticated;
grant usage,create on schema navrang_notification_bridge to service_role;
grant usage on schema navrang_notification_bridge to navrang_notification_worker;

create function navrang_notification_bridge.claim(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare delivery_enabled boolean;
begin
 if p_limit is null or p_limit<1 or p_limit>20 then raise exception 'Invalid delivery batch size'; end if;
 -- Avoid pruning on calls that observe disabled delivery. Use no new lock:
 -- the legacy claim prunes before rechecking the switches, so a concurrent
 -- disable after this read may still allow retention pruning; the legacy claim
 -- rechecks flags before leasing. A send already in flight cannot be recalled.
 -- Avoiding a new lock order also permits a drained legacy worker to overlap
 -- briefly without creating a lock inversion on the config and receipt rows.
 select center_enabled and notification_config.delivery_enabled into delivery_enabled
  from navrang_private.notification_config where singleton;
 if delivery_enabled is distinct from true then return '[]'::jsonb; end if;
 return navrang_private.claim_notification_deliveries(p_limit);
end;
$body$;
create function navrang_notification_bridge.check_delivery(p_id bigint,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $body$
begin
 if p_id is null or p_id<=0 or p_lease is null then raise exception 'Invalid delivery lease'; end if;
 return navrang_private.check_notification_delivery(p_id,p_lease);
end;
$body$;
create function navrang_notification_bridge.finish(p_id bigint,p_lease uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $body$
begin
 if p_id is null or p_id<=0 or p_lease is null or p_outcome is null
 or p_outcome not in ('accepted','retry','invalid','cancelled') then raise exception 'Invalid delivery outcome'; end if;
 return navrang_private.finish_notification_delivery(p_id,p_lease,p_outcome);
end;
$body$;
create function navrang_notification_bridge.is_active_admin(p_token text) returns boolean
language plpgsql security definer set search_path='' as $body$
declare actor jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
 actor:=navrang_private.resolve_actor(p_token);
 return coalesce(actor->'admin'='true'::jsonb and actor->'active'='true'::jsonb and not (actor ? 'error'),false);
end;
$body$;

revoke all on all functions in schema navrang_notification_bridge from public,anon,authenticated;
grant execute on function navrang_notification_bridge.claim(integer),
 navrang_notification_bridge.check_delivery(bigint,uuid),
 navrang_notification_bridge.finish(bigint,uuid,text),
 navrang_notification_bridge.is_active_admin(text) to navrang_notification_worker;
alter function navrang_notification_bridge.claim(integer) owner to service_role;
alter function navrang_notification_bridge.check_delivery(bigint,uuid) owner to service_role;
alter function navrang_notification_bridge.finish(bigint,uuid,text) owner to service_role;
alter function navrang_notification_bridge.is_active_admin(text) owner to service_role;
revoke all on schema navrang_notification_bridge from service_role;

do $postflight$
begin
 if pg_catalog.pg_has_role('navrang_notification_worker','service_role','MEMBER')
 or pg_catalog.has_schema_privilege('navrang_notification_worker','navrang_private','USAGE')
 or pg_catalog.has_schema_privilege('navrang_notification_worker','navrang_notification_bridge','CREATE')
 or pg_catalog.has_schema_privilege('service_role','navrang_notification_bridge','CREATE') then
  raise exception 'Notification worker or API schema has unsafe inherited privileges'; end if;
 if exists(select 1 from pg_catalog.pg_namespace n,
  lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
  where n.nspname='navrang_notification_bridge' and
   (a.grantee not in (n.nspowner,'navrang_notification_worker'::regrole) or a.is_grantable
    or (a.grantee='navrang_notification_worker'::regrole and a.privilege_type<>'USAGE'))) then
  raise exception 'Unexpected notification API schema ACL'; end if;
 if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     where n.nspname='navrang_notification_bridge')<>4
 or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='navrang_notification_bridge' and (p.proowner<>'service_role'::regrole or not p.prosecdef
   or p.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.grantee not in (p.proowner,'navrang_notification_worker'::regrole) or a.is_grantable))) then
  raise exception 'Unexpected notification wrapper ownership, configuration, or ACL'; end if;
 if not pg_catalog.has_function_privilege('navrang_notification_worker','navrang_notification_bridge.claim(integer)','EXECUTE')
 or not pg_catalog.has_function_privilege('navrang_notification_worker','navrang_notification_bridge.check_delivery(bigint,uuid)','EXECUTE')
 or not pg_catalog.has_function_privilege('navrang_notification_worker','navrang_notification_bridge.finish(bigint,uuid,text)','EXECUTE')
 or not pg_catalog.has_function_privilege('navrang_notification_worker','navrang_notification_bridge.is_active_admin(text)','EXECUTE') then
  raise exception 'Missing notification wrapper grant'; end if;
end;
$postflight$;
commit;
