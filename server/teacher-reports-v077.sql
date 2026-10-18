-- Navrang v0.7.7: additive, service-only teacher reporting.
-- No student data is copied into the APK or a public repository.
create table if not exists navrang_private.report_grants (
 checker_id uuid primary key references navrang_private.checkers(id) on delete cascade,
 enabled boolean not null default false,
 granted_at timestamptz not null default now(),
 granted_by text not null default 'admin'
);
create table if not exists navrang_private.report_exports (
 id bigint generated always as identity primary key,
 actor text not null,
 report_kind text not null,
 row_count integer not null check(row_count >= 0),
 at timestamptz not null default now()
);
alter table navrang_private.report_grants enable row level security;
alter table navrang_private.report_exports enable row level security;
revoke all on navrang_private.report_grants, navrang_private.report_exports from public, anon, authenticated;

create or replace function public.navrang_reports(p_action text,p jsonb default '{}'::jsonb,p_token text default ''::text)
returns jsonb
language plpgsql
set search_path to ''
as $report$
declare
 s navrang_private.sessions%rowtype;
 c navrang_private.checkers%rowtype;
 granted boolean := false;
 admin_ok boolean := false;
 permitted boolean := false;
 kind text;
 rows jsonb;
 totals jsonb;
 n integer;
begin
 select * into s from navrang_private.sessions where hash=p_token and expires_at>now();
 if not found then return jsonb_build_object('error','Sign in again.','status',401); end if;
 admin_ok := s.role='admin';
 if s.role='checker' then
  select * into c from navrang_private.checkers where id=s.checker_id;
  select coalesce(g.enabled,false) into granted from navrang_private.report_grants g where g.checker_id=c.id;
 end if;
 permitted := admin_ok or (coalesce(c.active,false) and c.method='google' and
   c.google_id is not null and coalesce(granted,false) and
   (c.access_expires_at is null or c.access_expires_at>now()));
 if p_action='access' then
  return jsonb_build_object('allowed',permitted,'role',case when admin_ok then 'admin' when permitted then 'teacher' else 'none' end);
 end if;
 if p_action='members' then
  if not admin_ok then return jsonb_build_object('error','Administrator required.','status',403);end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c2.id,'name',c2.name,'email',c2.email,
   'active',c2.active,'scanner',c2.scanner_enabled,'helpdesk',c2.helpdesk_enabled,
   'teacher',coalesce(g.enabled,false)) order by c2.name,c2.id),'[]'::jsonb)
  into rows
  from navrang_private.checkers c2 left join navrang_private.report_grants g on g.checker_id=c2.id
  where c2.method='google';
  return jsonb_build_object('members',rows);
 end if;
 if p_action='grant' then
  if not admin_ok then return jsonb_build_object('error','Administrator required.','status',403);end if;
  if coalesce(p->>'checkerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'enabled') is distinct from 'boolean' then
   return jsonb_build_object('error','Invalid teacher permission request.','status',400);
  end if;
  select * into c from navrang_private.checkers where id=(p->>'checkerId')::uuid for update;
  if not found or c.method<>'google' or c.google_id is null then
   return jsonb_build_object('error','Teacher must sign in with a verified Google account first.','status',400);
  end if;
  if (p->>'enabled')::boolean then
   if c.scanner_enabled or c.helpdesk_enabled or c.selected_station in ('checker','helpdesk') then
    return jsonb_build_object('error','Disable this account’s Checker/Help Desk station before granting teacher-only reports.','status',409);
   end if;
   update navrang_private.checkers set active=true where id=c.id;
  end if;
  insert into navrang_private.report_grants(checker_id,enabled,granted_at,granted_by)
   values(c.id,(p->>'enabled')::boolean,now(),'admin')
   on conflict(checker_id) do update set enabled=excluded.enabled,granted_at=excluded.granted_at,granted_by=excluded.granted_by;
  return jsonb_build_object('saved',true,'checkerId',c.id,'enabled',(p->>'enabled')::boolean);
 end if;
 if not permitted then return jsonb_build_object('error','Teacher reports permission required.','status',403);end if;
 if p_action='summary' then
  select jsonb_build_object(
   'registered',count(*),'eligible',count(*) filter(where eligible),
   'blocked',count(*) filter(where not eligible),
   'attended',count(*) filter(where eligible and exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=t.id and not a.test_fixture)),
   'noShow',count(*) filter(where eligible and not exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=t.id and not a.test_fixture))
  ) into totals from navrang_private.tickets t where t.active;
  select totals || jsonb_build_object(
   'serverIssues',(select count(*) from navrang_private.attempts a where not a.test_fixture and a.response->>'code' in ('blocked','not_found')),
   'issueTickets',(select count(distinct a.ticket_id) from navrang_private.attempts a where not a.test_fixture and a.response->>'code' in ('blocked','not_found')),
   'duplicateAttempts',(select count(*) from navrang_private.attempts a where not a.test_fixture and a.response->>'code'='duplicate'),
   'pendingHelpDesk',(select count(*) from navrang_private.helpdesk_registrations where status='pending'),
   'generatedAt',now(),
   'offlineCompleteness','Unsent or lost local scans cannot be verified from server data.'
  ) into totals;
  return jsonb_build_object('stats',totals);
 end if;
 if p_action<>'export' then return jsonb_build_object('error','Unknown report action.','status',400);end if;
 kind := p->>'kind';
 if kind not in ('all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending') or kind is null then
  return jsonb_build_object('error','Unknown report dataset.','status',400);
 end if;
 if kind in ('all','attended','absent','blocked') then
  with x as (
   select t.id,t.name,t.eligible,t.reason,t.description,t.amount,
    a.at as entry_time,a.receipt#>>'{entry,checker}' as checker,
    (select count(*) from navrang_private.attempts z where not z.test_fixture and z.ticket_id=t.id and z.response->>'code' in ('blocked','not_found')) as issue_attempts,
    (select count(*) from navrang_private.attempts z where not z.test_fixture and z.ticket_id=t.id and z.response->>'code'='duplicate') as duplicate_attempts
   from navrang_private.tickets t left join navrang_private.admissions a on a.event_id='O9KL3' and a.ticket_id=t.id and not a.test_fixture
   where t.active
  )
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',id,'Name',name,'Eligible',eligible,'Eligibility issue',reason,
   'Payment result',description,'Amount INR',amount,'Attendance',case when entry_time is not null then 'Attended' when eligible then 'No verified entry' else 'Not eligible' end,
   'Entered UTC',entry_time,'Checker',checker,'Server issue attempts',issue_attempts,'Duplicate attempts',duplicate_attempts) order by name,id),'[]'::jsonb) into rows
  from x where kind='all' or kind='attended' and entry_time is not null or kind='absent' and eligible and entry_time is null or kind='blocked' and not eligible;
 elsif kind in ('issues','resolved','unresolved') then
  with x as (
   select a.ticket_id,min(a.at) first_at,count(*) issue_attempts,
    string_agg(distinct a.response->>'code',', ' order by a.response->>'code') issue_codes
   from navrang_private.attempts a
   where not a.test_fixture and a.response->>'code' in ('blocked','not_found')
   group by a.ticket_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',x.ticket_id,'Name',coalesce(t.name,'Unmatched ticket'),
   'Issue codes',x.issue_codes,'Issue attempts',x.issue_attempts,'First issue UTC',x.first_at,
   'Outcome',case when a.at is null then 'No verified entry' else 'Resolved with admission' end,'Entered UTC',a.at) order by x.first_at,x.ticket_id),'[]'::jsonb) into rows
  from x left join navrang_private.tickets t on t.id=x.ticket_id and t.active
  left join navrang_private.admissions a on a.ticket_id=x.ticket_id and a.event_id='O9KL3' and not a.test_fixture
  where kind='issues' or kind='resolved' and a.at is not null or kind='unresolved' and a.at is null;
 elsif kind='duplicates' then
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',x.ticket_id,'Name',coalesce(t.name,'Unmatched ticket'),
   'Duplicate attempts',x.tries,'First duplicate UTC',x.first_at,'Last duplicate UTC',x.last_at) order by x.last_at desc,x.ticket_id),'[]'::jsonb) into rows
  from (select ticket_id,count(*) tries,min(at) first_at,max(at) last_at from navrang_private.attempts
   where not test_fixture and response->>'code'='duplicate' group by ticket_id) x
  left join navrang_private.tickets t on t.id=x.ticket_id and t.active;
 elsif kind='activity' then
  select coalesce(jsonb_agg(jsonb_build_object('Hour IST',x.hour_ist,'Checker',x.checker,'Confirmed entries',x.entry_count) order by x.hour_ist,x.checker),'[]'::jsonb) into rows
  from (select to_char(a.at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:00') hour_ist,
   coalesce(c.name,'Administrator') checker,count(*) entry_count
   from navrang_private.admissions a left join navrang_private.checkers c on c.id=a.checker_id
   where a.event_id='O9KL3' and not a.test_fixture
   group by 1,2) x;
 elsif kind in ('helpdesk','pending') then
  select coalesce(jsonb_agg(jsonb_build_object('Ticket ID',h.ticket_id,'Name',h.details->>'name',
   'Status',h.status,'Created UTC',h.created_at,'Reviewed UTC',h.reviewed_at,'Recorded by',h.created_by_name) order by h.created_at,h.ticket_id),'[]'::jsonb) into rows
  from navrang_private.helpdesk_registrations h where kind='helpdesk' or h.status='pending';
 end if;
 n:=jsonb_array_length(rows);
 if n>10000 then return jsonb_build_object('error','Report too large to download.','status',413);end if;
 insert into navrang_private.report_exports(actor,report_kind,row_count) values(case when admin_ok then 'admin' else c.id::text end,kind,n);
 return jsonb_build_object('kind',kind,'count',n,'generatedAt',now(),'rows',rows);
end
$report$;
revoke all on function public.navrang_reports(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_reports(text,jsonb,text) to service_role;
