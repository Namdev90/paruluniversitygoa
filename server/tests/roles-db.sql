-- All staff fixtures and any admission are transaction-only; always ROLLBACK.
do $$
declare
 admin_token text=repeat('6',64); desk_token text=repeat('7',64); scan_token text=repeat('8',64); pending_token text=repeat('9',64);
 desk uuid=gen_random_uuid(); scanner uuid=gen_random_uuid(); newcomer uuid=gen_random_uuid(); gid uuid=gen_random_uuid();
 r jsonb; r2 jsonb; email text=gen_random_uuid()::text||'@example.invalid'; ticket text='HD'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
begin
 insert into navrang_private.sessions(hash,role,expires_at) values(admin_token,'admin',now()+interval '1 hour');
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,helpdesk_enabled) values(desk,'Synthetic Help Desk','code',true,true,false,true),(scanner,'Synthetic Checker','code',true,true,true,false);
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(desk_token,'checker',desk,now()+interval '1 hour'),(scan_token,'checker',scanner,now()+interval '1 hour');
 r=public.navrang_gate('me','{}',desk_token);if r->>'scanner'<>'false' or r->>'helpdesk'<>'true' then raise exception 'Wrong Help Desk profile';end if;
 r=public.navrang_gate('sync','{}',desk_token);if r->>'status'<>'403' then raise exception 'Help Desk downloaded checker roster';end if;
 r=public.navrang_gate('checkin',jsonb_build_object('ticketId',ticket,'requestId',gen_random_uuid(),'deviceId','rollback-roles'),desk_token);if r->>'status'<>'403' then raise exception 'Help Desk admitted a student';end if;
 r=public.navrang_gate('helpdesk-list','{}',scan_token);if r->>'status'<>'403' then raise exception 'Checker accessed private Help Desk contacts';end if;
 r=public.navrang_gate('staff-update',jsonb_build_object('id',scanner,'active',true,'helpdesk',true),scan_token);if r->>'status'<>'403' then raise exception 'Checker elevated own role';end if;
 r=public.navrang_gate('google-register',jsonb_build_object('id',gid,'name','Synthetic Google','email',email),'');newcomer=(r->>'id')::uuid;
 if newcomer is null or r->>'active'<>'false' or r->>'scanner'<>'false' or r->>'helpdesk'<>'false' then raise exception 'New Google identity auto-authorized a station';end if;
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(pending_token,'checker',newcomer,now()+interval '1 hour');
 r=public.navrang_gate('staff-request','{"station":"helpdesk"}',pending_token);if r->>'status'<>'403' then raise exception 'Unconfirmed name requested access';end if;
 r=public.navrang_gate('checker-profile','{"name":"Synthetic Raju"}',pending_token);if r->>'saved'<>'true' then raise exception 'Pending user could not save name';end if;
 r=public.navrang_gate('staff-request','{"station":"helpdesk"}',pending_token);if r->>'requested'<>'helpdesk' then raise exception 'Access request not saved';end if;
 r=public.navrang_gate('me','{}',pending_token);if r->>'active'<>'false' or r->>'helpdesk'<>'false' then raise exception 'Request granted access';end if;
 r=public.navrang_gate('staff-update',jsonb_build_object('id',newcomer,'name','Synthetic Raju','active',true,'scanner',false,'helpdesk',true),admin_token);if r->'checker'->>'helpdesk'<>'true' then raise exception 'Admin did not grant Help Desk';end if;
 r=public.navrang_gate('me','{}',pending_token);if r->>'active'<>'true' or r->>'scanner'<>'false' or r->>'helpdesk'<>'true' or r->>'requestedRole'<>'' then raise exception 'Existing session did not pick up role grant';end if;
 r=public.navrang_gate('google-register',jsonb_build_object('id',gid,'name','Ignored Rename','email',upper(email)),'');if r->>'id'<>newcomer::text or r->>'name'<>'Synthetic Raju' or r->>'scanner'<>'false' or r->>'helpdesk'<>'true' then raise exception 'Google login duplicated account or reset assigned name/permissions';end if;
 r=public.navrang_gate('staff-update',jsonb_build_object('id',newcomer,'name','Synthetic Renamed','active',true,'scanner',true,'helpdesk',false),admin_token);
 r=public.navrang_gate('me','{}',pending_token);if r->>'name'<>'Synthetic Renamed' or r->>'scanner'<>'true' or r->>'helpdesk'<>'false' then raise exception 'Admin name/role change failed';end if;
 r=public.navrang_gate('helpdesk-list','{}',pending_token);if r->>'status'<>'403' then raise exception 'Help Desk revocation failed';end if;
 r=public.navrang_gate('staff-update',jsonb_build_object('id',newcomer,'active',false),admin_token);
 r=public.navrang_gate('google-register',jsonb_build_object('id',gid,'name','Ignored','email',email),'');if r->>'active'<>'false' then raise exception 'Google login undid suspension';end if;
 update navrang_private.checkers set access_expires_at=now()-interval '1 second' where id=desk;
 r=public.navrang_gate('me','{}',desk_token);if r->>'status'<>'401' then raise exception 'Expired test code session remained usable';end if;
 r=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('0',64),'role','checker','checkerId',desk),'');if r->>'status'<>'403' then raise exception 'Expired test code created a new session';end if;
 raise notice 'PASS: separated stations, no self-elevation, Google retained with name/identity preserved, approval/revocation on existing sessions, expiring test access';
end $$;
