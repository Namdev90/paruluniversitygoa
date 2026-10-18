-- Disposable database only. The runner owns BEGIN / SET LOCAL ROLE / ROLLBACK.
do $test$
declare
 admin_token text:=repeat('a',64); null_staff_token text:=repeat('b',64);
 expired_token text:=repeat('c',64); expired_access_token text:=repeat('d',64);
 entry record; staff_id uuid; session_token text; actor jsonb; expected jsonb;
 scanner_id uuid; scanner_token text; faculty_id uuid; faculty_token text;
 pending_id uuid; pending_token text; expired_id uuid:=gen_random_uuid();
 prior_revision bigint; next_revision bigint; count_before bigint; count_after bigint;
begin
 if to_regprocedure('navrang_private.resolve_actor(text)') is null or
    to_regprocedure('public.navrang_communications(text,jsonb,text)') is null then
  raise exception 'Missing communications capability resolver and service RPC';
 end if;
 insert into navrang_private.sessions(hash,role,expires_at)
 values(admin_token,'admin',clock_timestamp()+interval '1 hour');
 actor:=public.navrang_communications('capabilities','{}',admin_token);
 expected:='{"principal":"admin","admin":true,"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb;
 if actor-'capabilityRevision' is distinct from expected or
    coalesce((actor->>'capabilityRevision')::bigint,0)<1 then
  raise exception 'Admin principal or separate audience capabilities incorrect: %',actor;
 end if;

 for entry in select * from (values
  (1,'Code checker','code',true,false,true,false,'checker',false,false,'{"scanner":true,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (2,'Google checker','google',true,true,true,false,'checker',false,false,'{"scanner":true,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (3,'Unconfirmed Google','google',true,false,true,false,'checker',false,false,'{"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (4,'Help Desk','code',true,true,false,true,'helpdesk',false,false,'{"scanner":false,"helpdesk":true,"faculty":false,"active":true}'::jsonb),
  (5,'Faculty','google',true,true,false,false,'',true,false,'{"scanner":false,"helpdesk":false,"faculty":true,"active":true}'::jsonb),
  (6,'Forged code faculty','code',true,true,false,false,'',true,false,'{"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (7,'Conflicting faculty checker','google',true,true,true,false,'checker',true,false,'{"scanner":true,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (8,'Conflicting faculty desk','google',true,true,false,true,'helpdesk',true,false,'{"scanner":false,"helpdesk":true,"faculty":false,"active":true}'::jsonb),
  (9,'Wrong selected station','code',true,true,true,false,'helpdesk',false,false,'{"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (10,'Dual unselected station','code',true,true,true,true,'',false,false,'{"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (11,'Dual selected checker','code',true,true,true,true,'checker',false,false,'{"scanner":true,"helpdesk":false,"faculty":false,"active":true}'::jsonb),
  (12,'Pending account','google',false,true,false,false,'',false,true,'{"scanner":false,"helpdesk":false,"faculty":false,"active":false}'::jsonb),
  (13,'Pending faculty request','google',true,true,false,false,'',false,true,'{"scanner":false,"helpdesk":false,"faculty":false,"active":true}'::jsonb)
 ) as fixtures(n,label,method,active,name_confirmed,scanner,helpdesk,station,grant_enabled,report_pending,want)
 loop
  staff_id:=gen_random_uuid();session_token:=repeat(lpad(entry.n::text,2,'0'),32);
  insert into navrang_private.checkers(id,name,method,google_id,email,active,name_confirmed,scanner_enabled,helpdesk_enabled,selected_station,requested_role)
  values(staff_id,entry.label,entry.method,case when entry.method='google' then gen_random_uuid() else null end,
   staff_id::text||'@example.invalid',entry.active,entry.name_confirmed,entry.scanner,entry.helpdesk,entry.station,
   case when entry.report_pending then 'checker' else '' end);
  insert into navrang_private.sessions(hash,role,checker_id,expires_at)
  values(session_token,'checker',staff_id,clock_timestamp()+interval '1 hour');
  if entry.grant_enabled then
   insert into navrang_private.report_grants(checker_id,enabled) values(staff_id,true);
  end if;
  if entry.report_pending then
   insert into navrang_private.report_requests(checker_id,state) values(staff_id,'pending');
  end if;
  actor:=navrang_private.resolve_actor(session_token);
  expected:=entry.want||jsonb_build_object('principal',staff_id::text,'admin',false);
  if actor-'capabilityRevision' is distinct from expected or
     coalesce((actor->>'capabilityRevision')::bigint,0)<1 then
   raise exception 'Incorrect effective capabilities for %: %',entry.label,actor;
  end if;
  if entry.n=1 then scanner_id:=staff_id;scanner_token:=session_token;end if;
  if entry.n=5 then faculty_id:=staff_id;faculty_token:=session_token;end if;
  if entry.n=13 then pending_id:=staff_id;pending_token:=session_token;end if;
  actor:=public.navrang_communications('notifications-feed','{}',session_token);
  if actor->>'status' is distinct from '503' then
   raise exception 'Disabled feed did not fail closed for %: %',entry.label,actor;
  end if;
 end loop;

 -- Same bearer must resolve administrator changes immediately, not login metadata.
 actor:=navrang_private.resolve_actor(scanner_token);prior_revision:=(actor->>'capabilityRevision')::bigint;
 update navrang_private.checkers set scanner_enabled=false,helpdesk_enabled=true,selected_station='helpdesk' where id=scanner_id;
 actor:=navrang_private.resolve_actor(scanner_token);next_revision:=(actor->>'capabilityRevision')::bigint;
 if actor->>'scanner'<>'false' or actor->>'helpdesk'<>'true' or next_revision<=prior_revision then
  raise exception 'Station reassignment did not refresh same bearer and capability revision';
 end if;
 prior_revision:=next_revision;
 update navrang_private.checkers set active=false where id=scanner_id;
 actor:=navrang_private.resolve_actor(scanner_token);next_revision:=(actor->>'capabilityRevision')::bigint;
 if actor->>'active'<>'false' or actor->>'helpdesk'<>'false' or next_revision<=prior_revision then
  raise exception 'Revocation retained active capability or old generation';
 end if;
 prior_revision:=next_revision;
 update navrang_private.checkers set active=active,scanner_enabled=scanner_enabled where id=scanner_id;
 actor:=navrang_private.resolve_actor(scanner_token);
 if (actor->>'capabilityRevision')::bigint<>prior_revision then raise exception 'No-op checker update invalidated capability generation';end if;

 actor:=navrang_private.resolve_actor(faculty_token);prior_revision:=(actor->>'capabilityRevision')::bigint;
 update navrang_private.report_grants set enabled=false where checker_id=faculty_id;
 actor:=navrang_private.resolve_actor(faculty_token);next_revision:=(actor->>'capabilityRevision')::bigint;
 if actor->>'faculty'<>'false' or next_revision<=prior_revision then raise exception 'Faculty grant revocation not fresh';end if;
 prior_revision:=next_revision;
 update navrang_private.report_grants set granted_at=clock_timestamp(),enabled=false where checker_id=faculty_id;
 actor:=navrang_private.resolve_actor(faculty_token);
 if (actor->>'capabilityRevision')::bigint<>prior_revision then raise exception 'Grant metadata-only update invalidated capability generation';end if;
 update navrang_private.report_grants set enabled=true where checker_id=faculty_id;
 actor:=navrang_private.resolve_actor(faculty_token);
 if actor->>'faculty'<>'true' or (actor->>'capabilityRevision')::bigint<=prior_revision then raise exception 'Faculty regrant reset or retained old revision';end if;
 actor:=navrang_private.resolve_actor(pending_token);prior_revision:=(actor->>'capabilityRevision')::bigint;
 update navrang_private.report_requests set state='approved' where checker_id=pending_id;
 actor:=navrang_private.resolve_actor(pending_token);
 if actor->>'faculty'<>'false' or (actor->>'capabilityRevision')::bigint<>prior_revision then raise exception 'Editable/request state granted faculty access';end if;

 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(null_staff_token,'checker',null,clock_timestamp()+interval '1 hour'),
       (expired_token,'admin',null,clock_timestamp()-interval '1 second');
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station,access_expires_at)
 values(expired_id,'Expired staff','code',true,true,true,'checker',clock_timestamp()-interval '1 second');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(expired_access_token,'checker',expired_id,clock_timestamp()+interval '1 hour');
 foreach session_token in array array['',repeat('e',64),null_staff_token,expired_token,expired_access_token] loop
  actor:=navrang_private.resolve_actor(session_token);
  if actor->>'status' is distinct from '401' or actor ? 'principal' then
   raise exception 'Missing/expired identity resolved authority or exposed principal: %',actor;
  end if;
 end loop;
 actor:=public.navrang_communications('capabilities','{"role":"admin"}',admin_token);
 if actor->>'status'<>'400' then raise exception 'Internal capabilities accepted forged payload';end if;
 actor:=public.navrang_communications('unknown','{}',admin_token);
 if actor->>'status'<>'400' then raise exception 'Unknown RPC action was accepted';end if;
 actor:=public.navrang_communications('voice-floor','{}',admin_token);
 if actor->>'status'<>'503' then raise exception 'Unimplemented voice returned successful authority';end if;

 -- Catalog assertions run as service_role: no accidental PUBLIC/anon/auth access.
 if not (select relrowsecurity from pg_class where oid='navrang_private.communication_capability_revisions'::regclass) then
  raise exception 'Capability revisions table lacks RLS';
 end if;
 if (select prosecdef from pg_proc where oid='public.navrang_communications(text,jsonb,text)'::regprocedure) or
    (select prosecdef from pg_proc where oid='navrang_private.resolve_actor(text)'::regprocedure) then
  raise exception 'Communication RPC/resolver bypasses invoker privileges';
 end if;
 foreach session_token in array array['anon','authenticated'] loop
  if has_schema_privilege(session_token,'navrang_private','USAGE') or
     has_table_privilege(session_token,'navrang_private.communication_capability_revisions','SELECT,INSERT,UPDATE,DELETE') or
     has_sequence_privilege(session_token,'navrang_private.communication_capability_revision_seq','USAGE,SELECT,UPDATE') or
     has_function_privilege(session_token,'public.navrang_communications(text,jsonb,text)','EXECUTE') or
     has_function_privilege(session_token,'navrang_private.resolve_actor(text)','EXECUTE') or
     has_function_privilege(session_token,'navrang_private.bump_communication_capability(text)','EXECUTE') then
   raise exception 'Unprivileged role % gained private communications access',session_token;
  end if;
 end loop;
 if not has_function_privilege('service_role','public.navrang_communications(text,jsonb,text)','EXECUTE') or
    not has_sequence_privilege('service_role','navrang_private.communication_capability_revision_seq','USAGE,SELECT') then
  raise exception 'Service communications permissions are incomplete';
 end if;
 select count(*) into count_before from navrang_private.communication_capability_revisions;
 actor:=navrang_private.resolve_actor(admin_token);
 select count(*) into count_after from navrang_private.communication_capability_revisions;
 if count_before<>count_after then raise exception 'Read-only resolver mutated capability state';end if;
 raise notice 'PASS: current station/report permissions, monotonic revocation, missing identities denied, private invoker/RLS/ACL, transports fail closed';
end;
$test$;
