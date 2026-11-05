-- PROPOSAL ONLY: apply transactionally only after explicit production approval,
-- preflight of the service role and hosted ownership-transfer capability, and
-- isolated tests. Never add a login or password in this migration.
begin;
set local search_path=pg_catalog;
do $preflight$
declare role_row record; installer record;
begin
 if to_regrole('navrang_voice_worker') is not null or to_regnamespace('navrang_voice_worker_api') is not null then
  raise exception 'Voice worker role or API schema already exists; manual review required';
 end if;
 select rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication into role_row
  from pg_catalog.pg_roles where rolname='service_role';
 if not found or role_row.rolcanlogin or role_row.rolsuper or not role_row.rolbypassrls
    or role_row.rolcreatedb or role_row.rolcreaterole or role_row.rolreplication then
  raise exception 'Existing service_role is not a NOLOGIN, non-superuser RLS-bypassing service role';
 end if;
 if current_user='service_role' then raise exception 'Migration owner must be distinct from service_role';end if;
 select rolsuper,rolcreaterole into installer from pg_catalog.pg_roles where rolname=current_user;
 if not found or not (installer.rolsuper or installer.rolcreaterole)
    or not pg_catalog.pg_has_role(current_user,'service_role','SET')
    or not pg_catalog.has_database_privilege(current_user,current_database(),'CREATE') then
  raise exception 'Installer lacks role creation, schema creation, or service_role SET authority';
 end if;
 if to_regprocedure('navrang_private.voice_rpc(text,jsonb,text)') is null
    or not has_schema_privilege('service_role','navrang_private','USAGE')
    or not has_function_privilege('service_role','navrang_private.voice_rpc(text,jsonb,text)','EXECUTE') then
  raise exception 'Existing private voice function or service privileges are absent';
 end if;
 if exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.member where r.rolname='service_role') then
  raise exception 'service_role has inherited role memberships; review before installation';
 end if;
 if exists(select 1 from pg_catalog.pg_namespace n,
   lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
   where n.nspname='navrang_private' and a.grantee=0 and a.privilege_type='CREATE') then
  raise exception 'Private schema is publicly writable';
 end if;
end;
$preflight$;

create role navrang_voice_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create schema navrang_voice_worker_api;
revoke all on schema navrang_voice_worker_api from public;
grant usage on schema navrang_voice_worker_api to navrang_voice_worker;

-- Strictly Cloudflare-supported actor actions; controller actions never use this path.
create function navrang_voice_worker_api.actor(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $actor$
begin
 if p_action is null or p_action <> all(array['duty-join','duty-heartbeat','duty-leave',
  'voice-join','voice-invite','voice-broadcast-start','voice-broadcast-end','voice-release',
  'floor-prepare','floor-fail','relay-operation','relay-plan','relay-receive',
  'relay-renew-prepare','relay-ack','relay-commit']) or p is null or jsonb_typeof(p)<>'object'
  or octet_length(p::text)>8192 or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('error','Invalid voice request.','status',400);
 end if;
 return navrang_private.voice_rpc(p_action,p,p_token);
end;
$actor$;

-- Only the Cloudflare controller lifecycle; never accepts an app bearer.
create function navrang_voice_worker_api.controller(p_action text,p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $controller$
begin
 if p_action is null or p_action <> all(array['controller-claim','controller-poll','controller-ack',
  'controller-relay-ack','controller-heartbeat','controller-release']) or p is null
  or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 then
  return jsonb_build_object('error','Invalid controller request.','status',400);
 end if;
 return navrang_private.voice_rpc(p_action,p,''::text);
end;
$controller$;

revoke all on function navrang_voice_worker_api.actor(text,jsonb,text) from public;
revoke all on function navrang_voice_worker_api.controller(text,jsonb) from public;
grant execute on function navrang_voice_worker_api.actor(text,jsonb,text) to navrang_voice_worker;
grant execute on function navrang_voice_worker_api.controller(text,jsonb) to navrang_voice_worker;
-- ALTER OWNER requires the new owner to have CREATE on the target schema.
-- This temporary privilege is never committed; the installer must itself have
-- ownership-transfer authority. Failure rolls back the complete migration.
grant create on schema navrang_voice_worker_api to service_role;
alter function navrang_voice_worker_api.actor(text,jsonb,text) owner to service_role;
alter function navrang_voice_worker_api.controller(text,jsonb) owner to service_role;
revoke create on schema navrang_voice_worker_api from service_role;
do $postflight$
begin
 if pg_catalog.pg_has_role('navrang_voice_worker','service_role','MEMBER')
   or pg_catalog.has_schema_privilege('navrang_voice_worker','navrang_private','USAGE')
   or pg_catalog.has_schema_privilege('service_role','navrang_voice_worker_api','CREATE')
   or pg_catalog.has_schema_privilege('navrang_voice_worker','navrang_voice_worker_api','CREATE')
   or not pg_catalog.has_schema_privilege('navrang_voice_worker','navrang_voice_worker_api','USAGE')
   or exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.member where r.rolname='navrang_voice_worker')
   or exists(select 1 from pg_catalog.pg_namespace n,
    lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
    where n.nspname='navrang_voice_worker_api' and
      (a.grantee not in (n.nspowner,pg_catalog.to_regrole('navrang_voice_worker')::oid)
       or (a.grantee=pg_catalog.to_regrole('navrang_voice_worker')::oid and a.is_grantable)))
   or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     join pg_catalog.pg_roles r on r.oid=p.proowner
     where n.nspname='navrang_voice_worker_api' and r.rolname='service_role' and p.prosecdef)=2 is not true
   or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where n.nspname='navrang_voice_worker_api' and
       (a.grantee not in (p.proowner,pg_catalog.to_regrole('navrang_voice_worker')::oid)
        or (a.grantee=pg_catalog.to_regrole('navrang_voice_worker')::oid and a.is_grantable)))
   or pg_catalog.has_function_privilege('anon','navrang_voice_worker_api.actor(text,jsonb,text)','EXECUTE')
   or pg_catalog.has_function_privilege('anon','navrang_voice_worker_api.controller(text,jsonb)','EXECUTE')
   or pg_catalog.has_function_privilege('authenticated','navrang_voice_worker_api.actor(text,jsonb,text)','EXECUTE')
   or pg_catalog.has_function_privilege('authenticated','navrang_voice_worker_api.controller(text,jsonb)','EXECUTE') then
  raise exception 'Voice worker API privilege verification failed';
 end if;
end;
$postflight$;
commit;
