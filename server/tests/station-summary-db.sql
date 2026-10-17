-- Run only inside BEGIN / ROLLBACK. No fixture survives this check.
do $$
declare
 ck uuid=gen_random_uuid(); other_ck uuid=gen_random_uuid(); desk uuid=gen_random_uuid();
 a_token text=repeat('a',64); s_token text=repeat('b',64); d_token text=repeat('c',64);
 before_count bigint; r jsonb; tid text; i integer;
begin
 select count(*) into before_count from navrang_private.admissions where not test_fixture;
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,helpdesk_enabled,selected_station)
 values(ck,'Summary Test Checker','code',true,true,true,false,'checker'),(other_ck,'Summary Other Checker','code',true,true,true,false,'checker'),(desk,'Summary Help Desk','code',true,true,false,true,'helpdesk');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(a_token,'admin',null,now()+interval '1 hour'),(s_token,'checker',ck,now()+interval '1 hour'),(d_token,'checker',desk,now()+interval '1 hour');
 for i in 1..3 loop
  tid='SY'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into navrang_private.admissions(event_id,ticket_id,checker_id,receipt) values('O9KL3',tid,case when i<3 then ck else other_ck end,'{}');
 end loop;
 r=public.navrang_gate('sync','{"dataRevision":-1,"afterSeq":-1}',s_token);
 if r->>'staffSummary' is distinct from 'true' or r->'records' is distinct from 'null'::jsonb or r->'entries' is distinct from '[]'::jsonb or r ? 'checkers' then raise exception 'Staff sync exposed roster, history or staff list';end if;
 if r->'stats' is distinct from jsonb_build_object('ownScans',2,'totalEntries',before_count+3) then raise exception 'Wrong own/total counts or extra statistics';end if;
 r=public.navrang_gate('sync','{}',d_token);if r->'stats' is distinct from jsonb_build_object('ownScans',0,'totalEntries',before_count+3) then raise exception 'Help Desk cannot get its minimal summary';end if;
 r=public.navrang_gate('staff-request','{"station":"helpdesk"}',s_token);if r->>'status' is distinct from '409' then raise exception 'Staff changed saved station';end if;
 r=public.navrang_gate('staff-request','{"station":"checker"}',s_token);if r->>'station' is distinct from 'checker' then raise exception 'Same choice was not idempotent';end if;
 r=public.navrang_gate('staff-update',jsonb_build_object('id',ck,'active',true,'scanner',false,'helpdesk',true),a_token);
 r=public.navrang_gate('me','{}',s_token);if r->>'station' is distinct from 'helpdesk' then raise exception 'Admin station change did not reach existing session';end if;
 r=public.navrang_gate('checkin',jsonb_build_object('ticketId','DEMO0001','requestId',gen_random_uuid(),'deviceId','rollback-summary'),s_token);if r->>'status' is distinct from '403' then raise exception 'Reassigned Help Desk could still scan';end if;
 r=public.navrang_gate('sync','{}',s_token);if r->'stats' is distinct from jsonb_build_object('ownScans',2,'totalEntries',before_count+3) then raise exception 'Role change lost attribution or leaked data';end if;
 raise notice 'PASS: permanent station, admin reassignment, two-counter summaries, no roster/entry/staff disclosure';
end $$;
