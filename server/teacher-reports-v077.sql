-- Navrang 0.7.7: additive, service-only reporting; no public student-data access.
create table if not exists navrang_private.report_grants (
 checker_id uuid primary key references navrang_private.checkers(id) on delete cascade,
 enabled boolean not null default false, granted_at timestamptz not null default now(), granted_by text not null default 'admin'
);
create table if not exists navrang_private.report_requests (
 checker_id uuid primary key references navrang_private.checkers(id) on delete cascade,
 requested_at timestamptz not null default now(), state text not null default 'pending' check(state in ('pending','approved','revoked'))
);
create table if not exists navrang_private.report_exports (
 id bigint generated always as identity primary key, actor text not null,
 report_kind text not null, row_count integer not null check(row_count>=0), at timestamptz not null default now()
);
alter table navrang_private.report_grants enable row level security;
alter table navrang_private.report_requests enable row level security;
alter table navrang_private.report_exports enable row level security;
revoke all on navrang_private.report_grants,navrang_private.report_requests,navrang_private.report_exports from public,anon,authenticated;
grant select,insert,update,delete on navrang_private.report_grants,navrang_private.report_requests,navrang_private.report_exports to service_role;
grant usage,select on sequence navrang_private.report_exports_id_seq to service_role;

create or replace function public.navrang_reports(p_action text,p jsonb default '{}'::jsonb,p_token text default ''::text)
returns jsonb language plpgsql set search_path to '' as $report$
declare
 s navrang_private.sessions%rowtype; c navrang_private.checkers%rowtype;
 granted boolean:=false; requested boolean:=false; admin_ok boolean:=false; permitted boolean:=false;
 kind text; rows jsonb; totals jsonb; n integer; generated_at timestamptz:=transaction_timestamp();
begin
 select * into s from navrang_private.sessions where hash=p_token and expires_at>now();
 if not found then return jsonb_build_object('error','Sign in again.','status',401);end if;
 admin_ok:=s.role='admin';
 if s.role='checker' then
  select * into c from navrang_private.checkers where id=s.checker_id;
  if not found or (c.access_expires_at is not null and c.access_expires_at<=now()) then return jsonb_build_object('error','Account expired. Sign in again.','status',401);end if;
  select coalesce(g.enabled,false) into granted from navrang_private.report_grants g where g.checker_id=c.id;
  select r.state='pending' into requested from navrang_private.report_requests r where r.checker_id=c.id;
 end if;
 permitted:=admin_ok or (coalesce(c.active,false) and c.method='google' and c.google_id is not null and c.name_confirmed
  and not c.scanner_enabled and not c.helpdesk_enabled and coalesce(granted,false));
 if p_action='access' then
  return jsonb_build_object('allowed',permitted,'requested',coalesce(requested,false),'role',case when admin_ok then 'admin' when permitted then 'teacher' else 'none' end);
 end if;
 if p_action='request' then
  if admin_ok then return jsonb_build_object('allowed',true,'requested',false);end if;
  if c.method is distinct from 'google' or c.google_id is null then return jsonb_build_object('error','Use your verified Google account for Faculty.','status',403);end if;
  if not c.name_confirmed then return jsonb_build_object('error','Save your real name first.','status',403);end if;
  if c.scanner_enabled or c.helpdesk_enabled then return jsonb_build_object('error','Ask the administrator to change your current working station first.','status',409);end if;
  if permitted then return jsonb_build_object('allowed',true,'requested',false);end if;
  insert into navrang_private.report_requests(checker_id,state) values(c.id,'pending')
   on conflict(checker_id) do update set state='pending',requested_at=case when navrang_private.report_requests.state='pending' then navrang_private.report_requests.requested_at else now() end;
  return jsonb_build_object('requested',true,'allowed',false);
 end if;
 if p_action='members' then
  if not admin_ok then return jsonb_build_object('error','Administrator required.','status',403);end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',ck.id,'name',ck.name,'email',ck.email,'active',ck.active,
   'nameConfirmed',ck.name_confirmed,'scanner',ck.scanner_enabled,'helpdesk',ck.helpdesk_enabled,
   'teacher',coalesce(g.enabled,false),'requested',coalesce(r.state='pending',false),'requestState',r.state,'requestedAt',r.requested_at)
   order by coalesce(r.state='pending',false) desc,ck.name,ck.id),'[]'::jsonb) into rows
  from navrang_private.checkers ck left join navrang_private.report_grants g on g.checker_id=ck.id
   left join navrang_private.report_requests r on r.checker_id=ck.id where ck.method='google';
  return jsonb_build_object('members',rows);
 end if;
 if p_action='grant' then
  if not admin_ok then return jsonb_build_object('error','Administrator required.','status',403);end if;
  if coalesce(p->>'checkerId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'enabled') is distinct from 'boolean' then return jsonb_build_object('error','Invalid teacher permission request.','status',400);end if;
  select * into c from navrang_private.checkers where id=(p->>'checkerId')::uuid for update;
  if not found or c.method<>'google' or c.google_id is null then return jsonb_build_object('error','Teacher must first sign in with a verified Google account.','status',400);end if;
  if (p->>'enabled')::boolean then
   if c.access_expires_at is not null and c.access_expires_at<=now() then return jsonb_build_object('error','Account access has expired. Renew it before granting reports.','status',409);end if;
   if not c.name_confirmed then return jsonb_build_object('error','Teacher must save their real name first.','status',409);end if;
   if c.scanner_enabled or c.helpdesk_enabled then return jsonb_build_object('error','Disable this account’s Checker/Help Desk access before granting teacher-only reports.','status',409);end if;
   update navrang_private.checkers set active=true,selected_station='',requested_role='' where id=c.id;
  end if;
  insert into navrang_private.report_grants(checker_id,enabled,granted_at,granted_by) values(c.id,(p->>'enabled')::boolean,now(),'admin')
   on conflict(checker_id) do update set enabled=excluded.enabled,granted_at=excluded.granted_at,granted_by=excluded.granted_by;
  insert into navrang_private.report_requests(checker_id,state) values(c.id,case when (p->>'enabled')::boolean then 'approved' else 'revoked' end)
   on conflict(checker_id) do update set state=excluded.state;
  return jsonb_build_object('saved',true,'checkerId',c.id,'enabled',(p->>'enabled')::boolean);
 end if;
 if not permitted then return jsonb_build_object('error','Teacher reports permission required.','status',403);end if;
 if p_action='summary' then
  select jsonb_build_object('registered',count(*),'eligible',count(*) filter(where t.eligible),'blocked',count(*) filter(where not t.eligible),
   'registeredAttended',(select count(*) from navrang_private.admissions a where a.event_id='O9KL3' and not a.test_fixture and (a.receipt#>>'{entry,admissionBasis}') is distinct from 'organizer_confirmed' and exists(select 1 from navrang_private.tickets known where known.id=a.ticket_id)),
   'eligibleRegisteredAttended',count(*) filter(where t.eligible and exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=t.id and not a.test_fixture and (a.receipt#>>'{entry,admissionBasis}') is distinct from 'organizer_confirmed')),
   'noShow',count(*) filter(where t.eligible and not exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=t.id and not a.test_fixture)))
  into totals from navrang_private.tickets t where t.active;
  totals:=totals||jsonb_build_object(
   'attended',(select count(*) from navrang_private.admissions a where a.event_id='O9KL3' and not a.test_fixture),
   'organizerConfirmed',(select count(*) from navrang_private.admissions a where a.event_id='O9KL3' and not a.test_fixture and a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed'),
   'unmatchedAttendees',(select count(*) from navrang_private.admissions a where a.event_id='O9KL3' and not a.test_fixture and not exists(select 1 from navrang_private.tickets t where t.id=a.ticket_id and t.active)),
   'serverIssues',(select count(*) from navrang_private.attempts a where not a.test_fixture and a.response->>'code' in ('blocked','not_found')),
   'issueTickets',(select count(distinct a.ticket_id) from navrang_private.attempts a where not a.test_fixture and a.response->>'code' in ('blocked','not_found')),
   'duplicateAttempts',(select count(*) from navrang_private.attempts a where not a.test_fixture and a.response->>'code'='duplicate'),
   'pendingHelpDesk',(select count(*) from navrang_private.helpdesk_registrations where status='pending'),
   'generatedAt',generated_at,'offlineCompleteness','Only server records and explicitly documented organizer confirmations are represented.',
   'attendanceBasis','Total attendance includes organizer-confirmed exceptions. Registered attendance and eligibility remain separate.');
  return jsonb_build_object('stats',totals);
 end if;
 if p_action<>'export' then return jsonb_build_object('error','Unknown report action.','status',400);end if;
 kind:=p->>'kind';
 if kind is null or kind not in ('all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending','corrections') then return jsonb_build_object('error','Unknown report dataset.','status',400);end if;
 if kind in ('all','attended','absent','blocked','corrections') then
  with x as (
   select coalesce(t.id,a.ticket_id) id,coalesce(t.active,false) registered,t.id is not null registration_retained,
    coalesce(nullif(t.name,''),case when a.receipt#>>'{entry,nameStatus}'='not_supplied' then null else a.receipt#>>'{entry,name}' end) name,
    t.eligible,t.reason,t.description,t.amount,a.ticket_id is not null admitted,a.at recorded_time,
    case when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then null else a.at end entry_time,
    a.receipt#>>'{entry,observedScanAt}' observed_scan,a.receipt#>>'{entry,checker}' checker,
    case when a.ticket_id is null then null else coalesce(a.receipt#>>'{entry,admissionBasis}','server_validated') end basis,
    a.receipt#>>'{entry,note}' note,a.receipt#>>'{entry,confirmationInstructionAt}' confirmation_time,
    (select count(*) from navrang_private.attempts z where not z.test_fixture and z.ticket_id=coalesce(t.id,a.ticket_id) and z.response->>'code' in ('blocked','not_found')) issue_attempts,
    (select count(*) from navrang_private.attempts z where not z.test_fixture and z.ticket_id=coalesce(t.id,a.ticket_id) and z.response->>'code'='duplicate') duplicate_attempts
   from navrang_private.tickets t full outer join
    (select * from navrang_private.admissions where event_id='O9KL3' and not test_fixture) a on a.ticket_id=t.id
   where coalesce(t.active,false) or a.ticket_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',id,'Name',name,'Name status',case when name is null then 'Not supplied' else 'Recorded' end,
   'In registration master',registered,'Registration retained',registration_retained,'Eligible',eligible,'Eligibility issue',reason,'Payment result',description,'Amount INR',amount,
   'Attendance',case when admitted then 'Admitted' when eligible then 'No verified entry' else 'Not eligible' end,
   'Admission basis',basis,'Note',note,'Verified entry UTC',entry_time,'Original scan UTC',observed_scan,'Record created UTC',recorded_time,
   'Organizer confirmation UTC',confirmation_time,'Checker / record source',checker,'Server issue attempts',issue_attempts,'Duplicate attempts',duplicate_attempts)
   order by name nulls last,id),'[]'::jsonb) into rows from x
  where kind='all' or kind='attended' and admitted or kind='absent' and registered and eligible and not admitted
   or kind='blocked' and registered and not eligible or kind='corrections' and basis='organizer_confirmed';
 elsif kind in ('issues','resolved','unresolved') then
  with x as (
   select z.ticket_id,min(z.at) first_at,count(*) issue_attempts,string_agg(distinct z.response->>'code',', ' order by z.response->>'code') issue_codes
   from navrang_private.attempts z where not z.test_fixture and z.response->>'code' in ('blocked','not_found') group by z.ticket_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',x.ticket_id,'Name',t.name,'Issue codes',x.issue_codes,'Issue attempts',x.issue_attempts,
   'First issue UTC',x.first_at,'Outcome',case when a.ticket_id is null then 'No verified entry' when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then 'Admitted — organizer confirmed' else 'Resolved with validated admission' end,
   'Admission basis',case when a.ticket_id is null then null else coalesce(a.receipt#>>'{entry,admissionBasis}','server_validated') end,
   'Note',a.receipt#>>'{entry,note}','Verified entry UTC',case when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then null else a.at end,
   'Record created UTC',a.at) order by x.first_at,x.ticket_id),'[]'::jsonb) into rows
  from x left join navrang_private.tickets t on t.id=x.ticket_id
   left join navrang_private.admissions a on a.ticket_id=x.ticket_id and a.event_id='O9KL3' and not a.test_fixture
  where kind='issues' or kind='resolved' and a.ticket_id is not null or kind='unresolved' and a.ticket_id is null;
 elsif kind='duplicates' then
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',x.ticket_id,'Name',t.name,'Duplicate attempts',x.tries,'First duplicate UTC',x.first_at,'Last duplicate UTC',x.last_at)
   order by x.last_at desc,x.ticket_id),'[]'::jsonb) into rows
  from (select ticket_id,count(*) tries,min(at) first_at,max(at) last_at from navrang_private.attempts where not test_fixture and response->>'code'='duplicate' group by ticket_id) x
   left join navrang_private.tickets t on t.id=x.ticket_id;
 elsif kind='activity' then
  select coalesce(jsonb_agg(jsonb_build_object('Hour IST',x.hour_ist,'Record source',x.source,'Time basis',x.time_basis,'Admissions',x.entry_count)
   order by x.hour_ist,x.source),'[]'::jsonb) into rows
  from (select to_char(case when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then (a.receipt#>>'{entry,observedScanAt}')::timestamptz else a.at end at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:00') hour_ist,
   case when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then 'Organizer-confirmed attendance' else coalesce(a.receipt#>>'{entry,checker}','Not recorded') end source,
   case when a.receipt#>>'{entry,admissionBasis}'='organizer_confirmed' then 'Original scan; exact admission time unknown' else 'Server-validated entry' end time_basis,count(*) entry_count
   from navrang_private.admissions a where a.event_id='O9KL3' and not a.test_fixture group by 1,2,3) x;
 elsif kind in ('helpdesk','pending') then
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',h.ticket_id,'Name',h.details->>'name','Status',h.status,'Created UTC',h.created_at,'Reviewed UTC',h.reviewed_at,'Recorded by',h.created_by_name)
   order by h.created_at,h.ticket_id),'[]'::jsonb) into rows from navrang_private.helpdesk_registrations h where kind='helpdesk' or h.status='pending';
 end if;
 n:=jsonb_array_length(rows);
 if n>10000 then return jsonb_build_object('error','Report too large to download.','status',413);end if;
 insert into navrang_private.report_exports(actor,report_kind,row_count) values(case when admin_ok then 'admin' else c.id::text end,kind,n);
 return jsonb_build_object('kind',kind,'count',n,'generatedAt',generated_at,'eventId','O9KL3','rows',rows);
end
$report$;
revoke all on function public.navrang_reports(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_reports(text,jsonb,text) to service_role;
