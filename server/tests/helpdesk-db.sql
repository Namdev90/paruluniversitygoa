-- Run with the new schema inside a transaction. Always roll back these fixtures.
do $$
declare
 ck uuid=gen_random_uuid(); other_ck uuid=gen_random_uuid(); registration uuid; request uuid=gen_random_uuid();
 admin_token text=repeat('1',64); desk_token text=repeat('2',64); other_token text=repeat('3',64);
 d jsonb='{"name":"Synthetic Desk Student","studentId":"SYNTHETIC-ONLY","college":"Test College","course":"Test Course","year":"1","phone":"9999999999","email":"test@example.invalid","ticketId":"","paymentStatus":"pending","paymentMethod":"unknown","paymentReference":"","notes":"Rollback-only fixture","issue":"new_registration","amount":null}';
 r jsonb; ticket text; before_receipt jsonb; after_receipt jsonb;
begin
 if has_table_privilege('anon','navrang_private.helpdesk_registrations','SELECT') or has_function_privilege('authenticated','public.navrang_gate(text,jsonb,text)','EXECUTE') then raise exception 'Help desk is publicly accessible';end if;
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,helpdesk_enabled) values(ck,'Synthetic Desk','code',true,true,true),(other_ck,'Synthetic Other','code',true,true,false);
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(admin_token,'admin',null,now()+interval '1 hour'),(desk_token,'checker',ck,now()+interval '1 hour'),(other_token,'checker',other_ck,now()+interval '1 hour');
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d),'');if r->>'status'<>'401' then raise exception 'Anonymous save not blocked';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d),other_token);if r->>'status'<>'403' then raise exception 'Unassigned checker save not blocked';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d),desk_token);registration=(r->'registration'->>'id')::uuid;ticket=r->'registration'->>'ticket_id';
 if registration is null or ticket !~ '^HD[A-F0-9]{6}$' or exists(select 1 from navrang_private.tickets where id=ticket) then raise exception 'Pending record authorized a ticket';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d),desk_token);if (r->'registration'->>'id')::uuid<>registration or not (r->>'replayed')::boolean then raise exception 'Save retry duplicated registration';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d||'{"name":"Changed"}'),desk_token);if r->>'status'<>'409' then raise exception 'Request ID reuse with changed payload accepted';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',gen_random_uuid(),'details',d),desk_token);if r->>'status'<>'409' then raise exception 'Duplicate student identity created another ticket';end if;
 r=public.navrang_gate('helpdesk-export','{}',desk_token);if r->>'status'<>'403' then raise exception 'Checker exported contacts';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',registration,'version',1,'status','approved'),desk_token);if r->>'status'<>'403' then raise exception 'Checker approved own registration';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',registration,'version',1,'status','approved'),admin_token);if r->>'status'<>'400' then raise exception 'Unpaid registration was approved';end if;
 d=d||jsonb_build_object('ticketId',ticket,'paymentStatus','paid','paymentMethod','cash','amount',100);
 r=public.navrang_gate('helpdesk-edit',jsonb_build_object('id',registration,'version',1,'details',d),admin_token);if r->'registration'->>'version'<>'2' then raise exception 'Versioned admin edit failed';end if;
 r=public.navrang_gate('helpdesk-edit',jsonb_build_object('id',registration,'version',1,'details',d),admin_token);if r->>'status'<>'409' then raise exception 'Stale edit overwrote new version';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',request,'details',d||jsonb_build_object('ticketId','','paymentStatus','pending','paymentMethod','unknown','amount',null)),desk_token);if not (r->>'replayed')::boolean then raise exception 'Retry after admin edit did not find original receipt';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',registration,'version',2,'status','approved','confirmExisting',true),admin_token);if r->'registration'->>'status'<>'approved' or not exists(select 1 from navrang_private.tickets where id=ticket and eligible and active) then raise exception 'Admin approval did not publish ticket';end if;
 r=public.navrang_gate('checkin',jsonb_build_object('ticketId',ticket,'requestId',gen_random_uuid(),'deviceId','rollback-test'),desk_token);if r->>'code'<>'admitted' then raise exception 'Approved ticket failed check-in';end if;before_receipt=r->'entry';
 r=public.navrang_gate('checkin',jsonb_build_object('ticketId',ticket,'requestId',gen_random_uuid(),'deviceId','rollback-test'),other_token);if r->>'code'<>'duplicate' or r->'entry'<>before_receipt then raise exception 'Duplicate changed original entry';end if;
 r=public.navrang_gate('helpdesk-list',jsonb_build_object('offset',0,'limit',2,'status','all','search','SYNTHETIC-ONLY'),desk_token);if r->>'total'<>'1' then raise exception 'Desk list missing own record';end if;
 update navrang_private.checkers set helpdesk_enabled=true where id=other_ck;
 r=public.navrang_gate('helpdesk-list',jsonb_build_object('offset',0,'limit',2,'status','all','search','SYNTHETIC-ONLY'),other_token);if r->>'total'<>'0' then raise exception 'Another desk saw private contacts';end if;
 r=public.navrang_gate('import','{"records":[],"source":"Rollback-only empty import"}',admin_token);if not exists(select 1 from navrang_private.tickets where id=ticket and active) then raise exception 'File update removed approved Help Desk ticket';end if;
 select receipt->'entry' into after_receipt from navrang_private.admissions where ticket_id=ticket;if after_receipt<>before_receipt then raise exception 'Import changed admission';end if;
 if (select count(*) from navrang_private.helpdesk_audit where registration_id=registration)<>3 then raise exception 'Audit trail incomplete';end if;
 raise notice 'PASS: Help Desk roles, contact isolation, retry recovery, pending payment, edit versioning, approval, single entry, file import preservation and audit';
end $$;

-- Current four-field form, email deduplication and explicit payment verification.
do $$
declare
 ck uuid=gen_random_uuid(); rid uuid; req uuid=gen_random_uuid(); admin_token text=repeat('4',64); desk_token text=repeat('5',64);
 d jsonb=jsonb_build_object('name','Synthetic Four Field Student','email',gen_random_uuid()::text||'@example.invalid','phone','9999999999','quantity',2);
 r jsonb; ticket text;
begin
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,helpdesk_enabled) values(ck,'Synthetic Desk V06','code',true,true,true);
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(admin_token,'admin',null,now()+interval '1 hour'),(desk_token,'checker',ck,now()+interval '1 hour');
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',req,'details',d),desk_token);rid=(r->'registration'->>'id')::uuid;ticket=r->'registration'->>'ticket_id';
 if rid is null or exists(select 1 from navrang_private.tickets where id=ticket) then raise exception 'Four-field form did not save pending';end if;
 r=public.navrang_gate('helpdesk-list',jsonb_build_object('offset',0,'limit',5,'search',d->>'email'),desk_token);if r->>'total'<>'1' then raise exception 'Four-field email search failed';end if;
 r=public.navrang_gate('helpdesk-save',jsonb_build_object('requestId',gen_random_uuid(),'details',d||jsonb_build_object('email',upper(d->>'email'))),desk_token);if r->>'status'<>'409' then raise exception 'Case-insensitive duplicate email accepted';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',rid,'version',1,'status','approved','confirmPayment',true),admin_token);if r->>'status'<>'400' then raise exception 'Group ticket approved for one entry';end if;
 d=d||'{"quantity":1}';r=public.navrang_gate('helpdesk-edit',jsonb_build_object('id',rid,'version',1,'details',d),admin_token);if r->'registration'->>'version'<>'2' then raise exception 'Four-field admin edit failed';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',rid,'version',2,'status','approved'),admin_token);if r->>'status'<>'400' then raise exception 'Approval without explicit payment confirmation accepted';end if;
 r=public.navrang_gate('helpdesk-review',jsonb_build_object('id',rid,'version',2,'status','approved','confirmPayment',true),admin_token);if r->'registration'->>'status'<>'approved' or not exists(select 1 from navrang_private.tickets where id=ticket and eligible and amount=100 and quantity=1) then raise exception 'Verified four-field registration failed approval';end if;
 r=public.navrang_gate('helpdesk-edit',jsonb_build_object('id',rid,'version',3,'details',d),admin_token);if r->>'status'<>'409' then raise exception 'Approved record was editable';end if;
 raise notice 'PASS: four fields, email search/deduplication, single-person quantity, explicit payment approval and immutable approved record';
end $$;
