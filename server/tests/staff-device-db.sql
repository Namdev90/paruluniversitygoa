-- Run after schema.sql and staff-device-v092.sql against an isolated database.
begin;
insert into navrang_private.checkers(id,name,email,google_id,method,active,name_confirmed)
 values('10000000-0000-4000-8000-000000000001','Synthetic Faculty','faculty@example.invalid',
 '20000000-0000-4000-8000-000000000001','google',true,true);
insert into navrang_private.report_grants(checker_id,enabled,granted_by)
 values('10000000-0000-4000-8000-000000000001',true,'synthetic');
set local role service_role;
do $$
declare
 staff_id uuid:='10000000-0000-4000-8000-000000000001';
 admin_hash text:=repeat('a',64);
 staff_hash text:=repeat('b',64);
 issue jsonb:=jsonb_build_object('checkerId',staff_id,'inviteHash',repeat('c',64));
 pin jsonb:=jsonb_build_object('deviceHash',repeat('d',64),'pinProof',repeat('e',64));
 enroll jsonb:=pin||jsonb_build_object('inviteHash',repeat('c',64));
begin
 assert not has_function_privilege('anon','public.navrang_staff_device(text,jsonb,text)','execute');
 assert not has_function_privilege('authenticated','public.navrang_staff_device(text,jsonb,text)','execute');
 perform public.navrang_gate('session-create',jsonb_build_object('role','admin','hash',admin_hash),'');
 assert public.navrang_staff_device('staff-device-issue',issue,'')->>'status'='403';
 assert public.navrang_staff_device('staff-device-login',pin,'')->>'status'='403';
 assert public.navrang_staff_device('staff-device-issue',issue,admin_hash)->>'issued'='true';
 assert public.navrang_staff_device('staff-device-login',enroll,'')->>'checkerId'=staff_id::text;
 assert public.navrang_staff_device('staff-device-login',enroll,'')->>'checkerId'=staff_id::text;
 assert public.navrang_staff_device('staff-device-login',pin,'')->>'checkerId'=staff_id::text;
 assert public.navrang_staff_device('staff-device-login',enroll||jsonb_build_object('deviceHash',repeat('f',64)),'')->>'status'='403';
 perform public.navrang_gate('session-create',jsonb_build_object('role','checker','hash',staff_hash,'checkerId',staff_id),'');
 assert public.navrang_staff_device('staff-device-issue',issue,staff_hash)->>'status'='403';
 assert public.navrang_reports('access','{}',staff_hash)->>'allowed'='true';
 for attempt in 1..10 loop
  assert public.navrang_staff_device('staff-device-login',pin||jsonb_build_object('pinProof',repeat('f',64)),'')->>'status'='401';
 end loop;
 assert public.navrang_staff_device('staff-device-login',pin,'')->>'status'='403';
end $$;
rollback;
