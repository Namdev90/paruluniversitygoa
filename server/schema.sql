-- Service-only API. No client is granted table or RPC access.
create schema if not exists navrang_private;
revoke all on schema navrang_private from public, anon, authenticated;
grant usage on schema navrang_private to service_role;
create table navrang_private.event (
 id text primary key check(id='O9KL3'), data_revision bigint not null default 0,
 source text not null default '', updated_at timestamptz not null default now()
);
insert into navrang_private.event(id) values('O9KL3');
create table navrang_private.admin_credentials (
 username text primary key, salt text not null, hash text not null
);
create table navrang_private.checkers (
 id uuid primary key default gen_random_uuid(), google_id uuid unique,
 username text generated always as ('checker_' || replace(id::text,'-','')) stored unique,
 name text not null check(length(name) between 1 and 128), email text not null default '',
 method text not null check(method in ('google','code')), code_hash text unique,
 name_confirmed boolean not null default false,
 active boolean not null default false, created_at timestamptz not null default now()
);
create unique index checkers_google_email_unique on navrang_private.checkers(lower(email)) where method='google';
create table navrang_private.sessions (
 hash text primary key, role text not null check(role in ('admin','checker')),
 checker_id uuid references navrang_private.checkers(id), expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index sessions_expiry on navrang_private.sessions(expires_at);
create index sessions_checker on navrang_private.sessions(checker_id);
create table navrang_private.tickets (
 id text primary key check(id ~ '^[A-Z0-9]{8}$'), name text not null,
 amount numeric, quantity numeric, refund numeric, description text not null,
 eligible boolean not null, reason text not null, active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table navrang_private.admissions (
 event_id text not null references navrang_private.event(id), ticket_id text not null,
 seq bigint generated always as identity unique, checker_id uuid references navrang_private.checkers(id),
 at timestamptz not null default clock_timestamp(), receipt jsonb not null,
 test_fixture boolean not null default false,
 primary key(event_id,ticket_id)
);
create index admissions_checker on navrang_private.admissions(checker_id);
create table navrang_private.attempts (
 actor text not null, request_id uuid not null, ticket_id text not null, device_id text not null,
 at timestamptz not null default now(), response jsonb not null,
 test_fixture boolean not null default false,
 primary key(actor,request_id)
);
create table navrang_private.imports (
 revision bigint primary key, source text not null, at timestamptz not null default now(),
 total integer not null, eligible integer not null, actor text not null
);
create table navrang_private.login_limits (
 key text primary key, starts_at timestamptz not null, attempts integer not null
);
alter table navrang_private.event enable row level security;
alter table navrang_private.admin_credentials enable row level security;
alter table navrang_private.checkers enable row level security;
alter table navrang_private.sessions enable row level security;
alter table navrang_private.tickets enable row level security;
alter table navrang_private.admissions enable row level security;
alter table navrang_private.attempts enable row level security;
alter table navrang_private.imports enable row level security;
alter table navrang_private.login_limits enable row level security;
grant select,insert,update,delete on all tables in schema navrang_private to service_role;
grant usage,select on all sequences in schema navrang_private to service_role;

-- Server-only Help Desk records; no public table grants.
alter table navrang_private.checkers add column if not exists helpdesk_enabled boolean not null default false;
create table if not exists navrang_private.helpdesk_registrations (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 created_by text not null, created_by_name text not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 details jsonb not null check(jsonb_typeof(details)='object'), submitted_details jsonb not null,
 ticket_id text not null check(ticket_id ~ '^[A-Z0-9]{8}$'),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 version bigint not null default 1, reviewed_by_name text, reviewed_at timestamptz
);
create index if not exists helpdesk_created on navrang_private.helpdesk_registrations(created_at desc,id);
create index if not exists helpdesk_creator on navrang_private.helpdesk_registrations(created_by,created_at desc);
create unique index if not exists helpdesk_email_unique on navrang_private.helpdesk_registrations(lower(trim(details->>'email'))) where status in ('pending','approved') and coalesce(trim(details->>'email'),'')<>'';
create index if not exists helpdesk_ticket on navrang_private.helpdesk_registrations(ticket_id);
create unique index if not exists helpdesk_student_unique on navrang_private.helpdesk_registrations(lower(trim(details->>'college')),lower(trim(details->>'studentId'))) where status in ('pending','approved');
create table if not exists navrang_private.helpdesk_audit (
 id uuid primary key default gen_random_uuid(), registration_id uuid not null references navrang_private.helpdesk_registrations(id),
 at timestamptz not null default clock_timestamp(), actor text not null, actor_name text not null,
 action text not null check(action in ('create','edit','approved','rejected')), before_record jsonb, after_record jsonb not null
);
alter table navrang_private.helpdesk_registrations enable row level security;
alter table navrang_private.helpdesk_audit enable row level security;
revoke all on navrang_private.helpdesk_registrations,navrang_private.helpdesk_audit from public,anon,authenticated;
grant select,insert,update on navrang_private.helpdesk_registrations,navrang_private.helpdesk_audit to service_role;

-- Staff station permissions. Existing installs are migrated separately without revoking approved access.
alter table navrang_private.checkers add column if not exists scanner_enabled boolean not null default false;
alter table navrang_private.checkers add column if not exists requested_role text not null default '' check(requested_role in ('','checker','helpdesk'));
alter table navrang_private.checkers add column if not exists access_expires_at timestamptz;
alter table navrang_private.checkers add column if not exists selected_station text not null default '' check(selected_station in ('','checker','helpdesk'));

create or replace function public.navrang_gate(p_action text,p jsonb default '{}'::jsonb,p_token text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s navrang_private.sessions%rowtype; c navrang_private.checkers%rowtype;
 e navrang_private.event%rowtype; t navrang_private.tickets%rowtype;
 prior navrang_private.attempts%rowtype; a navrang_private.admissions%rowtype;
 result jsonb; entries jsonb; records jsonb; stats jsonb; staff jsonb;
 h navrang_private.helpdesk_registrations%rowtype; draft jsonb; total_count bigint; ticket_key text; changed jsonb;
 actor_key text; actor_name text; n integer; rev bigint; cursor_seq bigint; last_seq bigint;
begin
 if p_action='config' then
  return jsonb_build_object('eventId','O9KL3','eventName','Navrang 2026','pollMs',2000);
 elsif p_action='budget' then
  insert into navrang_private.login_limits(key,starts_at,attempts) values(p->>'key',now(),1)
  on conflict(key) do update set
   attempts=case when navrang_private.login_limits.starts_at < now()-interval '5 minutes' then 1 else navrang_private.login_limits.attempts+1 end,
   starts_at=case when navrang_private.login_limits.starts_at < now()-interval '5 minutes' then now() else navrang_private.login_limits.starts_at end
  returning attempts into n;
  return jsonb_build_object('allowed',n<=coalesce((p->>'limit')::integer,10));
 elsif p_action='credentials' then
  select jsonb_build_object('salt',salt,'hash',hash) into result from navrang_private.admin_credentials where username=p->>'username';
  return coalesce(result,'{}'::jsonb);
 elsif p_action='checker-credentials' then
  select jsonb_build_object('id',id,'name',name,'active',active and (access_expires_at is null or access_expires_at>now()),'method',method) into result from navrang_private.checkers where code_hash=p->>'hash';
  return coalesce(result,'{}'::jsonb);
 elsif p_action='google-register' then
  if coalesce(trim(p->>'email'),'')='' then return jsonb_build_object('error','Verified Google email required.','status',401);end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p->>'email')),0));
  select * into c from navrang_private.checkers where method='google' and (google_id=(p->>'id')::uuid or lower(email)=lower(trim(p->>'email'))) for update;
  if found then
   update navrang_private.checkers set email=lower(trim(p->>'email')) where id=c.id returning * into c;
  else
   insert into navrang_private.checkers(google_id,name,email,method,active,scanner_enabled) values((p->>'id')::uuid,left(p->>'name',128),lower(trim(p->>'email')),'google',false,false) returning * into c;
  end if;
  return jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'scanner',c.scanner_enabled,'station',c.selected_station,'requestedRole',c.requested_role,'accessExpiresAt',c.access_expires_at,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method);
 elsif p_action='session-create' then
  if p->>'role'='checker' then
   select * into c from navrang_private.checkers where id=(p->>'checkerId')::uuid;
   if not found or (c.access_expires_at is not null and c.access_expires_at<=now()) then return jsonb_build_object('error','Staff access expired. Ask Namdev for a new code.','status',403);end if;
  end if;
  insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(p->>'hash',p->>'role',c.id,least(now()+interval '12 hours',coalesce(c.access_expires_at,now()+interval '12 hours')));
  return jsonb_build_object('role',p->>'role','name',case when p->>'role'='admin' then 'namdev' else c.name end,'checkerId',c.id,'username',c.name,'accountKey',c.username,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method,'scanner',case when p->>'role'='admin' then true else c.scanner_enabled end,'station',c.selected_station,'requestedRole',c.requested_role,'accessExpiresAt',c.access_expires_at,'active',case when p->>'role'='admin' then true else c.active end,'expiresAt',least(now()+interval '12 hours',coalesce(c.access_expires_at,now()+interval '12 hours')));
 end if;
 select * into s from navrang_private.sessions where hash=p_token and expires_at>now();
 if not found then return jsonb_build_object('error','Sign in again. Your session expired.','status',401);end if;
 if s.role='checker' then select * into c from navrang_private.checkers where id=s.checker_id; if c.access_expires_at is not null and c.access_expires_at<=now() then return jsonb_build_object('error','Staff access expired. Ask Namdev for a new code.','status',401);end if;end if;
 actor_key=coalesce(c.id::text,'admin'); actor_name=case when s.role='admin' then 'namdev' else c.name end;
 if p_action='checker-profile' then
  if s.role<>'checker' then return jsonb_build_object('error','Checker account required.','status',403);end if;
  if length(trim(p->>'name')) not between 1 and 40 or trim(p->>'name') ~ '[@0-9]' then return jsonb_build_object('error','Enter a real name, up to 40 letters.','status',400);end if;
  update navrang_private.checkers set name=trim(p->>'name'),name_confirmed=true where id=c.id returning * into c;
  return jsonb_build_object('saved',true,'name',c.name);
 end if;
 if p_action='staff-request' then
  if s.role<>'checker' or not coalesce(c.name_confirmed,false) then return jsonb_build_object('error','Save your real name before choosing a station.','status',403);end if;
  if coalesce(p->>'station','') not in ('checker','helpdesk') then return jsonb_build_object('error','Choose Checker or Help Desk.','status',400);end if;
  select * into c from navrang_private.checkers where id=s.checker_id for update;
  if c.selected_station<>'' and c.selected_station<>p->>'station' then return jsonb_build_object('error','Your station is already saved. Only Namdev can change it in Admin → Staff.','status',409);end if;
  if c.selected_station='' then
   update navrang_private.checkers set selected_station=p->>'station',requested_role=case when active and ((p->>'station'='checker' and scanner_enabled) or (p->>'station'='helpdesk' and helpdesk_enabled)) then '' else p->>'station' end where id=c.id returning * into c;
  end if;
  return jsonb_build_object('station',c.selected_station,'requested',c.requested_role,'message','Station saved. Only Namdev can change it.');
 end if;
 if p_action='logout' then delete from navrang_private.sessions where hash=p_token;return jsonb_build_object('signedOut',true);end if;
 if p_action='me' then return jsonb_build_object('role',s.role,'name',actor_name,'checkerId',c.id,'username',c.name,'accountKey',c.username,'nameConfirmed',c.name_confirmed,'method',c.method,'scanner',s.role='admin' or coalesce(c.scanner_enabled,false),'station',c.selected_station,'requestedRole',c.requested_role,'accessExpiresAt',c.access_expires_at,'helpdesk',s.role='admin' or coalesce(c.helpdesk_enabled,false),'active',s.role='admin' or coalesce(c.active,false),'expiresAt',s.expires_at);end if;
 if s.role='checker' and not coalesce(c.active,false) then return jsonb_build_object('error','Your checker account needs admin approval or has been suspended.','status',403);end if;
 if p_action='checkin' and s.role='checker' and (not coalesce(c.scanner_enabled,false) or c.selected_station<>'checker') then return jsonb_build_object('error','Checker access required. Choose your assigned Help Desk station or ask Namdev.','status',403);end if;
 if p_action='checkin' and c.method='google' and not c.name_confirmed then return jsonb_build_object('error','Save your real checker name before scanning.','status',403);end if;
 if p_action in ('import','upsert','staff-create','staff-update','admin-password','helpdesk-review','helpdesk-edit','helpdesk-export') and s.role<>'admin' then return jsonb_build_object('error','Administrator access required.','status',403);end if;

 if p_action like 'helpdesk-%' then
  if s.role<>'admin' and (not coalesce(c.helpdesk_enabled,false) or c.selected_station<>'helpdesk') then return jsonb_build_object('error','Ask Namdev to enable Help Desk access for your account in Admin → Checkers.','status',403);end if;
  if s.role='checker' and c.method='google' and not c.name_confirmed then return jsonb_build_object('error','Save your real name first.','status',403);end if;
 end if;
 if p_action='helpdesk-save' then
  perform pg_advisory_xact_lock(hashtextextended(p->>'requestId',1));
  select * into h from navrang_private.helpdesk_registrations where request_id=(p->>'requestId')::uuid;
  if found then
   if h.created_by<>actor_key or h.submitted_details <> p->'details' then return jsonb_build_object('error','This request was already saved with different details. Refresh the Help Desk list.','status',409);end if;
   return jsonb_build_object('registration',to_jsonb(h),'saved',true,'replayed',true);
  end if;
  draft=p->'details';
  perform pg_advisory_xact_lock(hashtextextended(coalesce(nullif(lower(trim(draft->>'email')),''),lower(trim(draft->>'college'))||':'||lower(trim(draft->>'studentId'))),3));
  if exists(select 1 from navrang_private.helpdesk_registrations hd where hd.status in ('pending','approved') and ((coalesce(trim(draft->>'email'),'')<>'' and lower(trim(hd.details->>'email'))=lower(trim(draft->>'email'))) or (coalesce(trim(draft->>'studentId'),'')<>'' and lower(trim(hd.details->>'college'))=lower(trim(draft->>'college')) and lower(trim(hd.details->>'studentId'))=lower(trim(draft->>'studentId'))))) then return jsonb_build_object('error','A Help Desk case already exists for this email or student identity. Ask admin to check the saved list.','status',409);end if;
  ticket_key=nullif(draft->>'ticketId','');
  if ticket_key is null then
   loop
    ticket_key='HD'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    perform pg_advisory_xact_lock(hashtextextended(ticket_key,2));
    exit when not exists(select 1 from navrang_private.tickets where id=ticket_key) and not exists(select 1 from navrang_private.helpdesk_registrations where ticket_id=ticket_key);
   end loop;
  end if;
  insert into navrang_private.helpdesk_registrations(request_id,created_by,created_by_name,details,submitted_details,ticket_id)
   values((p->>'requestId')::uuid,actor_key,actor_name,draft||jsonb_build_object('ticketId',ticket_key),draft,ticket_key) returning * into h;
  insert into navrang_private.helpdesk_audit(registration_id,actor,actor_name,action,after_record) values(h.id,actor_key,actor_name,'create',to_jsonb(h));
  return jsonb_build_object('registration',to_jsonb(h),'saved',true);
 elsif p_action='helpdesk-list' then
  select count(*) into total_count from navrang_private.helpdesk_registrations hd
   where (s.role='admin' or hd.created_by=actor_key) and (coalesce(p->>'status','all')='all' or hd.status=p->>'status')
   and (coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(concat_ws(' ',hd.details->>'name',hd.details->>'email',hd.details->>'phone',hd.details->>'studentId',hd.ticket_id)))>0);
  select coalesce(jsonb_agg(to_jsonb(z) order by z.created_at desc,z.id),'[]') into records from (
   select hd.* from navrang_private.helpdesk_registrations hd where (s.role='admin' or hd.created_by=actor_key)
    and (coalesce(p->>'status','all')='all' or hd.status=p->>'status')
    and (coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(concat_ws(' ',hd.details->>'name',hd.details->>'email',hd.details->>'phone',hd.details->>'studentId',hd.ticket_id)))>0)
    order by hd.created_at desc,hd.id offset coalesce((p->>'offset')::integer,0) limit coalesce((p->>'limit')::integer,5)
  ) z;
  return jsonb_build_object('records',records,'total',total_count,'offset',coalesce((p->>'offset')::integer,0),'pageSize',coalesce((p->>'limit')::integer,5),
   'stats',(select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'approved',count(*) filter(where status='approved'),'rejected',count(*) filter(where status='rejected')) from navrang_private.helpdesk_registrations where s.role='admin' or created_by=actor_key));
 elsif p_action='helpdesk-export' then
  select coalesce(jsonb_agg(to_jsonb(z) order by z.created_at,z.id),'[]') into records from (select * from navrang_private.helpdesk_registrations order by created_at,id limit 10001) z;
  return jsonb_build_object('records',records);
 elsif p_action in ('helpdesk-edit','helpdesk-review') then
  select * into h from navrang_private.helpdesk_registrations where id=(p->>'id')::uuid for update;
  if not found then return jsonb_build_object('error','Help Desk record not found.','status',404);end if;
  if h.version<>(p->>'version')::bigint then return jsonb_build_object('error','Someone changed this record. Refresh before editing.','status',409);end if;
  changed=to_jsonb(h);
  if p_action='helpdesk-edit' then
   if h.status<>'pending' then return jsonb_build_object('error','Only pending records can be edited. Entry history stays unchanged.','status',409);end if;
   draft=p->'details';ticket_key=coalesce(nullif(draft->>'ticketId',''),h.ticket_id);
   perform pg_advisory_xact_lock(hashtextextended(coalesce(nullif(lower(trim(draft->>'email')),''),lower(trim(draft->>'college'))||':'||lower(trim(draft->>'studentId'))),3));
   if exists(select 1 from navrang_private.helpdesk_registrations hd where hd.id<>h.id and hd.status in ('pending','approved') and ((coalesce(trim(draft->>'email'),'')<>'' and lower(trim(hd.details->>'email'))=lower(trim(draft->>'email'))) or (coalesce(trim(draft->>'studentId'),'')<>'' and lower(trim(hd.details->>'college'))=lower(trim(draft->>'college')) and lower(trim(hd.details->>'studentId'))=lower(trim(draft->>'studentId'))))) then return jsonb_build_object('error','Another Help Desk case already uses this email or student identity.','status',409);end if;
   update navrang_private.helpdesk_registrations set details=h.details||draft||jsonb_build_object('ticketId',ticket_key),ticket_id=ticket_key,version=version+1,updated_at=clock_timestamp() where id=h.id returning * into h;
  else
   if h.status<>'pending' then return jsonb_build_object('error','This record was already reviewed. Refresh the list.','status',409);end if;
   if p->>'status'='approved' then
    if coalesce((h.details->>'quantity')::integer,1)<>1 then return jsonb_build_object('error','One ticket admits one person. Set quantity to one and register each other person separately before approving.','status',400);end if;
    if not coalesce((p->>'confirmPayment')::boolean,(p->>'confirmExisting')::boolean,false) then return jsonb_build_object('error','Verify this person and their payment, then confirm approval.','status',400);end if;
    -- The existing event lock also serializes check-in and file imports.
    perform 1 from navrang_private.event where id='O9KL3' for update;
    select * into t from navrang_private.tickets where id=h.ticket_id;
    if found then
     if not t.active or not t.eligible then return jsonb_build_object('error','This existing ticket still has an issue. Verify and correct it in Admin → Students before approving this case.','status',409);end if;
     if coalesce((p->>'confirmExisting')::boolean,false) is not true then return jsonb_build_object('error','Confirm that this existing ticket belongs to this student before linking it.','status',409);end if;
    else
     if not (h.details ? 'quantity') and (h.details->>'paymentStatus'<>'paid' or coalesce((h.details->>'amount')::numeric,0)<100) then return jsonb_build_object('error','Verify payment of at least ₹100 before approving a new entry ticket.','status',400);end if;
     insert into navrang_private.tickets(id,name,amount,quantity,refund,description,eligible,reason)
      values(h.ticket_id,h.details->>'name',case when h.details ? 'quantity' then 100 else (h.details->>'amount')::numeric end,1,0,'Transaction completed successfully',true,'Verified by admin at Help Desk');
     update navrang_private.event set data_revision=data_revision+1,updated_at=now() where id='O9KL3';
    end if;
   end if;
   update navrang_private.helpdesk_registrations set status=p->>'status',reviewed_by_name=actor_name,reviewed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=h.id returning * into h;
  end if;
  insert into navrang_private.helpdesk_audit(registration_id,actor,actor_name,action,before_record,after_record)
   values(h.id,actor_key,actor_name,case when p_action='helpdesk-edit' then 'edit' else p->>'status' end,changed,to_jsonb(h));
  return jsonb_build_object('registration',to_jsonb(h),'saved',true);
 end if;

 if p_action='staff-create' then
  insert into navrang_private.checkers(name,method,code_hash,active,name_confirmed,scanner_enabled,helpdesk_enabled,selected_station) values(left(trim(p->>'name'),40),'code',p->>'hash',true,true,coalesce((p->>'scanner')::boolean,true),coalesce((p->>'helpdesk')::boolean,false),case when coalesce((p->>'scanner')::boolean,true) and not coalesce((p->>'helpdesk')::boolean,false) then 'checker' when not coalesce((p->>'scanner')::boolean,true) and coalesce((p->>'helpdesk')::boolean,false) then 'helpdesk' else '' end) returning * into c;
  return jsonb_build_object('checker',jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'scanner',c.scanner_enabled,'station',c.selected_station,'requestedRole',c.requested_role,'accessExpiresAt',c.access_expires_at,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method));
 elsif p_action='staff-update' then
  update navrang_private.checkers set active=(p->>'active')::boolean,name=coalesce(nullif(trim(p->>'name'),''),name),name_confirmed=case when nullif(trim(p->>'name'),'') is not null then true else name_confirmed end,scanner_enabled=coalesce((p->>'scanner')::boolean,scanner_enabled),helpdesk_enabled=coalesce((p->>'helpdesk')::boolean,helpdesk_enabled),selected_station=case when coalesce((p->>'scanner')::boolean,scanner_enabled) and not coalesce((p->>'helpdesk')::boolean,helpdesk_enabled) then 'checker' when coalesce((p->>'helpdesk')::boolean,helpdesk_enabled) and not coalesce((p->>'scanner')::boolean,scanner_enabled) then 'helpdesk' else selected_station end,requested_role=case when (p->>'active')::boolean then '' else requested_role end where id=(p->>'id')::uuid returning * into c;
  if not found then return jsonb_build_object('error','Checker not found.','status',404);end if;
  return jsonb_build_object('checker',jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'scanner',c.scanner_enabled,'station',c.selected_station,'requestedRole',c.requested_role,'accessExpiresAt',c.access_expires_at,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method));
 elsif p_action='admin-password' then
  update navrang_private.admin_credentials set salt=p->>'salt',hash=p->>'hash' where username='namdev';
  delete from navrang_private.sessions where role='admin' and hash<>p_token;
  return jsonb_build_object('changed',true);
 elsif p_action in ('import','upsert') then
  select * into e from navrang_private.event where id='O9KL3' for update;
  if p_action='import' then update navrang_private.tickets ti set active=false where active and not exists(select 1 from navrang_private.helpdesk_registrations hd where hd.ticket_id=ti.id and hd.status='approved');end if;
  insert into navrang_private.tickets(id,name,amount,quantity,refund,description,eligible,reason,active,updated_at)
   select x.id,x.name,x.amount,x.quantity,x.refund,x.description,x.eligible,x.reason,true,now()
   from jsonb_to_recordset(p->'records') as x(id text,name text,amount numeric,quantity numeric,refund numeric,description text,eligible boolean,reason text)
  on conflict(id) do update set name=excluded.name,amount=excluded.amount,quantity=excluded.quantity,refund=excluded.refund,description=excluded.description,eligible=excluded.eligible,reason=excluded.reason,active=true,updated_at=now();
  update navrang_private.event set data_revision=data_revision+1,source=left(coalesce(p->>'source','Manual update'),200),updated_at=now() where id='O9KL3' returning data_revision into rev;
  insert into navrang_private.imports(revision,source,total,eligible,actor)
   select rev,left(coalesce(p->>'source','Manual update'),200),count(*),count(*) filter(where eligible),actor_name from navrang_private.tickets where active;
  return jsonb_build_object('dataRevision',rev,'saved',jsonb_array_length(p->'records'));
 elsif p_action='checkin' then
  select * into e from navrang_private.event where id='O9KL3' for update;
  select * into prior from navrang_private.attempts where actor=actor_key and request_id=(p->>'requestId')::uuid;
  if found then
   if prior.ticket_id<>p->>'ticketId' or prior.device_id<>p->>'deviceId' then return jsonb_build_object('error','This request ID was already used for another scan.','status',409);end if;
   return prior.response;
  end if;
  select * into a from navrang_private.admissions where event_id='O9KL3' and ticket_id=p->>'ticketId';
  if found then result=a.receipt||jsonb_build_object('code','duplicate');
  else
   select * into t from navrang_private.tickets where id=p->>'ticketId' and active;
   if not found then result=jsonb_build_object('code','not_found','id',p->>'ticketId','message','Not in the current registration list. Visit the help desk.');
   elsif not t.eligible then result=jsonb_build_object('code','blocked','id',t.id,'record',to_jsonb(t)-'updated_at','message',t.reason);
   else
    insert into navrang_private.admissions(event_id,ticket_id,checker_id,receipt) values('O9KL3',t.id,s.checker_id,'{}') returning * into a;
    result=jsonb_build_object('code','admitted','id',t.id,'record',to_jsonb(t)-'updated_at','entry',jsonb_build_object('ticketId',t.id,'name',t.name,'checker',actor_name,'checkerId',s.checker_id,'deviceId',p->>'deviceId','at',a.at,'seq',a.seq,'source',e.source));
    update navrang_private.admissions set receipt=result where event_id='O9KL3' and ticket_id=t.id;
   end if;
  end if;
  insert into navrang_private.attempts(actor,request_id,ticket_id,device_id,response) values(actor_key,(p->>'requestId')::uuid,p->>'ticketId',p->>'deviceId',result);
  return result;
 elsif p_action='sync' then
  if s.role='checker' then
   return jsonb_build_object('staffSummary',true,'scanner',c.scanner_enabled and c.selected_station='checker','dataRevision',-1,'cursor',0,'hasMore',false,'records',null,'entries','[]'::jsonb,'stats',jsonb_build_object('ownScans',(select count(*) from navrang_private.admissions where not test_fixture and checker_id=c.id),'totalEntries',(select count(*) from navrang_private.admissions where not test_fixture)));
  end if;
  select * into e from navrang_private.event where id='O9KL3';
  if coalesce((p->>'dataRevision')::bigint,-1)<>e.data_revision then
   select coalesce(jsonb_agg(to_jsonb(ts)-'active'-'updated_at' order by ts.id),'[]') into records from navrang_private.tickets ts where ts.active;
  end if;
  select coalesce(jsonb_agg(z.receipt->'entry' order by z.seq),'[]'),coalesce(max(z.seq),coalesce((p->>'afterSeq')::bigint,0)) into entries,cursor_seq
   from (select ad.seq,ad.receipt from navrang_private.admissions ad where not ad.test_fixture and ad.seq>coalesce((p->>'afterSeq')::bigint,0) order by ad.seq limit 500) z;
  select coalesce(max(seq),0) into last_seq from navrang_private.admissions where not test_fixture;
  select jsonb_build_object('total',count(*),'eligible',count(*) filter(where ti.eligible),'blocked',count(*) filter(where not ti.eligible),'remaining',count(*) filter(where ti.eligible and not exists(select 1 from navrang_private.admissions ad where not ad.test_fixture and ad.ticket_id=ti.id))) into stats from navrang_private.tickets ti where ti.active;
  stats=stats||jsonb_build_object('admitted',(select count(*) from navrang_private.admissions where not test_fixture),'lastMinute',(select count(*) from navrang_private.admissions where not test_fixture and (receipt#>>'{entry,admissionBasis}') is distinct from 'organizer_confirmed' and at>now()-interval '1 minute'),'lastFiveMinutes',(select count(*) from navrang_private.admissions where not test_fixture and (receipt#>>'{entry,admissionBasis}') is distinct from 'organizer_confirmed' and at>now()-interval '5 minutes'),'duplicateAttempts',(select count(*) from navrang_private.attempts where not test_fixture and response->>'code'='duplicate'),'blockedAttempts',(select count(*) from navrang_private.attempts where not test_fixture and response->>'code' in ('blocked','not_found')));
  if s.role='admin' then
   select coalesce(jsonb_agg(jsonb_build_object('id',ck.id,'username',ck.name,'accountKey',ck.username,'name',ck.name,'email',ck.email,'method',ck.method,'active',ck.active,'scanner',ck.scanner_enabled,'station',ck.selected_station,'requestedRole',ck.requested_role,'accessExpiresAt',ck.access_expires_at,'helpdesk',ck.helpdesk_enabled,'entries',(select count(*) from navrang_private.admissions ad where not ad.test_fixture and ad.checker_id=ck.id)) order by ck.created_at),'[]') into staff from navrang_private.checkers ck;
  end if;
  return jsonb_build_object('dataRevision',e.data_revision,'source',e.source,'updatedAt',e.updated_at,'records',records,'entries',entries,'cursor',cursor_seq,'hasMore',cursor_seq<last_seq,'stats',stats,'checkers',staff);
 end if;
 return jsonb_build_object('error','Unknown operation.','status',400);
end;
$$;
revoke all on function public.navrang_gate(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_gate(text,jsonb,text) to service_role;

-- BEGIN GENERATED TEACHER REPORTS (teacher-reports-v077.sql)
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
-- END GENERATED TEACHER REPORTS

-- BEGIN COMMUNICATIONS V080 FOUNDATION
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

-- END COMMUNICATIONS V080 FOUNDATION

-- BEGIN REPORT OPERATIONS V080
-- Additive service-only save receipts. Never stores report contents or filesystem paths.
create table if not exists navrang_private.report_operations (
 id uuid primary key default gen_random_uuid(), actor text not null,
 session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),
 request_id text not null check(length(request_id) between 1 and 128),
 kind text not null check(kind in ('all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending','corrections','summary')),
 format text not null check(format in ('csv','xlsx','pdf')),
 state text not null default 'prepared' check(state in ('prepared','initiated','saved','cancelled','failed')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 updated_at timestamptz not null default clock_timestamp(),
 unique(actor,session_hash,request_id),
 check((kind='summary' and format='pdf') or (kind<>'summary' and format in ('csv','xlsx')))
);
alter table navrang_private.report_operations enable row level security;
revoke all on navrang_private.report_operations from public,anon,authenticated;
grant select,insert,update on navrang_private.report_operations to service_role;

-- Transactional metadata-only extension point. Notification migration may replace
-- this private hook; an exception rolls back the receipt and its event together.
do $install_hook$
begin
 if to_regprocedure('navrang_private.report_operation_event(jsonb)') is null then
  execute $definition$
   create function navrang_private.report_operation_event(p_event jsonb)
   returns void language plpgsql security invoker set search_path='' as $hook$
   begin
    return;
   end;
   $hook$;
  $definition$;
 end if;
end;
$install_hook$;
revoke all on function navrang_private.report_operation_event(jsonb) from public,anon,authenticated;
grant execute on function navrang_private.report_operation_event(jsonb) to service_role;

create or replace function public.navrang_report_operations(p_action text,p jsonb default '{}'::jsonb,p_token text default '')
returns jsonb language plpgsql security invoker set search_path='' as $operation$
declare
 v_actor jsonb; principal text; v_request_id text; kind text; format text; outcome text;
 operation navrang_private.report_operations%rowtype; result jsonb; fresh boolean:=false;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>2048 then
  return jsonb_build_object('error','Invalid report operation payload.','status',400);
 end if;
 if p_action is null or p_action not in ('prepare-export','prepare-summary','outcome') then
  return jsonb_build_object('error','Unknown report operation.','status',400);
 end if;
 v_actor:=navrang_private.resolve_actor(p_token);
 if v_actor ? 'error' then return v_actor;end if;
 if not coalesce((v_actor->>'admin')::boolean,false) and not coalesce((v_actor->>'faculty')::boolean,false) then
  return jsonb_build_object('error','Teacher reports permission required.','status',403);
 end if;
 principal:=v_actor->>'principal';
 if p_action='outcome' then
  if p - array['operationId','outcome'] <> '{}'::jsonb or
     jsonb_typeof(p->'operationId') is distinct from 'string' or
     coalesce(p->>'operationId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
     jsonb_typeof(p->'outcome') is distinct from 'string' or
     coalesce(p->>'outcome','') not in ('initiated','saved','cancelled','failed') then
   return jsonb_build_object('error','Invalid save outcome.','status',400);
  end if;
  outcome:=p->>'outcome';
  select * into operation from navrang_private.report_operations
   where id=(p->>'operationId')::uuid and actor=principal and session_hash=p_token for update;
  if not found then return jsonb_build_object('error','Report operation not found.','status',404);end if;
  if operation.expires_at<=clock_timestamp() then return jsonb_build_object('error','Report operation expired.','status',410);end if;
  if operation.state<>outcome then
   if operation.state in ('saved','cancelled','failed') or (operation.state='prepared' and outcome='saved') then
    return jsonb_build_object('error','Conflicting save outcome.','status',409);
   end if;
   update navrang_private.report_operations set state=outcome,updated_at=clock_timestamp() where id=operation.id;
   perform navrang_private.report_operation_event(jsonb_build_object('operationId',operation.id,'actor',principal,'kind',operation.kind,'format',operation.format,'outcome',outcome,'deviceReported',true));
  end if;
  return jsonb_build_object('operationId',operation.id,'outcome',outcome,'deviceReported',true);
 end if;
 if jsonb_typeof(p->'requestId') is distinct from 'string' or coalesce(p->>'requestId','')!~'^[A-Za-z0-9._:-]{1,128}$' then
  return jsonb_build_object('error','Invalid report request ID.','status',400);
 end if;
 v_request_id:=p->>'requestId';
 if p_action='prepare-summary' then
  if p-array['requestId']<>'{}'::jsonb then return jsonb_build_object('error','Invalid summary request.','status',400);end if;
  kind:='summary';format:='pdf';
 else
  if p-array['requestId','kind','format']<>'{}'::jsonb or jsonb_typeof(p->'kind') is distinct from 'string' or jsonb_typeof(p->'format') is distinct from 'string' or
   coalesce(p->>'kind','') not in ('all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending','corrections') or coalesce(p->>'format','') not in ('csv','xlsx') then
   return jsonb_build_object('error','Invalid export request.','status',400);
  end if;
  kind:=p->>'kind';format:=p->>'format';
 end if;
 -- Serialize retries before invoking legacy exports, without changing that RPC.
 perform pg_advisory_xact_lock(hashtextextended(principal||':'||p_token||':'||v_request_id,0));
 select * into operation from navrang_private.report_operations r where r.actor=principal and r.session_hash=p_token and r.request_id=v_request_id for update;
 if found then
  if operation.kind<>kind or operation.format<>format then return jsonb_build_object('error','Request ID already used for another report.','status',409);end if;
  if operation.expires_at<=clock_timestamp() then return jsonb_build_object('error','Report operation expired.','status',410);end if;
 else fresh:=true;
 end if;
 result:=public.navrang_reports(case when kind='summary' then 'summary' else 'export' end,jsonb_build_object('kind',kind),p_token);
 if result ? 'error' then return result;end if;
 if fresh then
  insert into navrang_private.report_operations(actor,session_hash,request_id,kind,format)
   values(principal,p_token,v_request_id,kind,format) returning * into operation;
  perform navrang_private.report_operation_event(jsonb_build_object('operationId',operation.id,'actor',principal,'kind',kind,'format',format,'outcome','prepared','deviceReported',false));
 end if;
 return result||jsonb_build_object('operationId',operation.id,'deviceReported',true);
end;
$operation$;
revoke all on function public.navrang_report_operations(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_report_operations(text,jsonb,text) to service_role;

-- END REPORT OPERATIONS V080

-- BEGIN VOICE STATE V080
-- Additive, private voice state preparation. Apply after communications-v080.sql.
-- No relay credentials/tokens are stored or minted. Transport remains NOT_RUN.
-- A separately deployed one-second authenticated worker must enforce expiration;
-- these SQL leases alone do NOT stop media at a relay.
create table if not exists navrang_private.voice_runtime (
 singleton boolean primary key default true check(singleton),
 configured boolean not null default false,revocation_verified boolean not null default false,
 revocation_mode text not null default 'disabled' check(revocation_mode in ('disabled','cloud-explicit-cutoff','guarded-admission')),
 worker_at timestamptz
);
insert into navrang_private.voice_runtime(singleton) values(true) on conflict do nothing;
create table if not exists navrang_private.voice_duty (
 id uuid primary key default gen_random_uuid(),principal text not null,
 -- Keep this hash after logout until relay revocation is acknowledged. A cascade
 -- would erase the identity needed for removal (and a floor FK could block logout).
 session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),
 installation_id text not null check(length(installation_id) between 1 and 128),
 active boolean not null default true,expires_at timestamptz not null,
 unique(principal,installation_id)
);
create table if not exists navrang_private.voice_sessions (
 id uuid primary key default gen_random_uuid(),room uuid not null default gen_random_uuid() unique,
 kind text not null check(kind in ('channel','broadcast','private')),
 owner_principal text not null,audience jsonb not null,
 state text not null default 'active' check(state in ('active','ending','ended')),
 request_id uuid,created_at timestamptz not null default clock_timestamp(),
 unique(owner_principal,request_id)
);
create unique index if not exists voice_single_channel on navrang_private.voice_sessions(kind) where kind='channel' and state='active';
create table if not exists navrang_private.voice_members (
 session_id uuid not null references navrang_private.voice_sessions(id),
 duty_id uuid not null references navrang_private.voice_duty(id) on delete cascade,
 identity uuid not null default gen_random_uuid() unique,
 primary key(session_id,duty_id)
);
create table if not exists navrang_private.voice_floors (
 session_id uuid primary key references navrang_private.voice_sessions(id),
 generation bigint not null default 0,phase text not null default 'idle' check(phase in ('idle','granting','active','revoking')),
 principal text,identity uuid,duty_id uuid references navrang_private.voice_duty(id),
 lease_id uuid,expires_at timestamptz,operation_id uuid,
 request_id uuid
);
create table if not exists navrang_private.voice_commands (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null,
 session_id uuid not null references navrang_private.voice_sessions(id),
 room uuid not null,identity uuid not null,generation bigint not null,
 operation text not null check(operation in ('revoke','grant')),
 state text not null default 'pending' check(state in ('pending','acked','failed')),
 created_at timestamptz not null default clock_timestamp(),acked_at timestamptz,
 unique(operation_id,session_id,identity,operation)
);
create index if not exists voice_commands_pending on navrang_private.voice_commands(state,created_at);
do $acl$
declare name text;
begin
 foreach name in array array['voice_runtime','voice_duty','voice_sessions','voice_members','voice_floors','voice_commands'] loop
  execute format('alter table navrang_private.%I enable row level security',name);
  execute format('revoke all on navrang_private.%I from public,anon,authenticated',name);
  execute format('grant select,insert,update,delete on navrang_private.%I to service_role',name);
 end loop;
end;
$acl$;

create or replace function navrang_private.voice_allowed(actor jsonb,audience jsonb,owner_principal text)
returns boolean language sql security invoker set search_path='' as $allowed$
 select coalesce(actor->>'active'='true' and (actor->>'admin'='true' or actor->>'scanner'='true' or actor->>'helpdesk'='true' or actor->>'faculty'='true') and (
  actor->>'principal'=owner_principal or audience->>'type'='everyone' or
  (audience->>'type'='staff' and audience->'staffIds' ? (actor->>'principal')) or
  (audience->>'type'='roles' and (
   ((audience->'roles' ? 'administrator') and actor->>'admin'='true') or
   ((audience->'roles' ? 'checker') and actor->>'scanner'='true') or
   ((audience->'roles' ? 'helpdesk') and actor->>'helpdesk'='true') or
   ((audience->'roles' ? 'faculty') and actor->>'faculty'='true')
  ))),false);
$allowed$;
revoke all on function navrang_private.voice_allowed(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.voice_allowed(jsonb,jsonb,text) to service_role;

create or replace function navrang_private.voice_ready()
returns boolean language sql security invoker set search_path='' as $ready$
 select coalesce((select configured and revocation_verified and revocation_mode in ('cloud-explicit-cutoff','guarded-admission')
 and worker_at between clock_timestamp()-interval '3 seconds' and clock_timestamp()+interval '1 second'
 from navrang_private.voice_runtime where singleton),false)
 and not exists(select 1 from navrang_private.voice_commands where operation='grant' and state='failed');
$ready$;
revoke all on function navrang_private.voice_ready() from public,anon,authenticated;
grant execute on function navrang_private.voice_ready() to service_role;

-- Called only by a narrowly authenticated server worker, not the client router.
-- Returns durable revocation work; marking the database expired is not relay ACK.
create or replace function navrang_private.voice_expire()
returns jsonb language plpgsql security invoker set search_path='' as $expire$
declare f record;op uuid;checked_at timestamptz:=clock_timestamp();result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 update navrang_private.voice_duty set active=false where expires_at<=checked_at;
 for f in select floors.*,s.room from navrang_private.voice_floors floors
 join navrang_private.voice_sessions s on s.id=floors.session_id
 left join navrang_private.voice_duty d on d.id=floors.duty_id
 where floors.phase in ('active','granting') and
  (floors.expires_at<=checked_at or s.state<>'active' or not coalesce(d.active,false) or d.expires_at<=checked_at or
   not navrang_private.voice_allowed(navrang_private.resolve_actor(d.session_hash),s.audience,s.owner_principal))
 for update of floors
 loop
  op:=gen_random_uuid();
  -- A lost coordinator can have a grant RPC still in flight. Do not allow a
  -- replacement publisher merely because a subsequent revoke was acknowledged;
  -- the transport operator must reconcile that ambiguous command first.
  if f.phase='granting' then
   update navrang_private.voice_commands set state='failed' where operation_id=f.operation_id and operation='grant' and state='pending';
  end if;
  update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=f.session_id;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
  values(op,f.session_id,f.room,f.identity,f.generation+1,'revoke');
  update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
 end loop;
 -- Listening memberships also need authoritative removal after logout, role
 -- revocation or duty expiry, even if that member never held a speaking floor.
 for f in select m.session_id,m.identity,s.room,floors.generation
 from navrang_private.voice_members m join navrang_private.voice_duty d on d.id=m.duty_id
 join navrang_private.voice_sessions s on s.id=m.session_id
 join navrang_private.voice_floors floors on floors.session_id=s.id
 where (not d.active or d.expires_at<=checked_at or s.state<>'active' or
  not navrang_private.voice_allowed(navrang_private.resolve_actor(d.session_hash),s.audience,s.owner_principal))
 and not exists(select 1 from navrang_private.voice_commands commands where commands.identity=m.identity
  and commands.operation='revoke' and commands.state in ('pending','failed'))
 loop
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
  values(gen_random_uuid(),f.session_id,f.room,f.identity,f.generation,'revoke');
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'operationId',operation_id,'sessionId',session_id,'room',room,'identity',identity,'generation',generation,'operation',operation) order by created_at,id),'[]'::jsonb)
 into result from navrang_private.voice_commands where state in ('pending','failed') and operation='revoke';
 return jsonb_build_object('commands',result,'transport','NOT_RUN');
end;
$expire$;
revoke all on function navrang_private.voice_expire() from public,anon,authenticated;
grant execute on function navrang_private.voice_expire() to service_role;

-- ACK follows a verified strict relay removal, not simply a worker HTTP request.
create or replace function navrang_private.voice_ack_revoke(p_command uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path='' as $ack$
declare command navrang_private.voice_commands%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 select * into command from navrang_private.voice_commands where id=p_command and generation=p_generation and operation='revoke' for update;
 if not found then return jsonb_build_object('error','Removal command is stale.','status',409);end if;
 update navrang_private.voice_commands set state='acked',acked_at=clock_timestamp() where id=p_command;
 delete from navrang_private.voice_members members where members.identity=command.identity
 and not exists(select 1 from navrang_private.voice_floors floors where floors.identity=members.identity and floors.phase in ('active','granting'));
 if not exists(select 1 from navrang_private.voice_commands where operation_id=command.operation_id and operation='revoke' and state<>'acked') then
  update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null
  where operation_id=command.operation_id and phase='revoking';
 end if;
 update navrang_private.voice_sessions s set state='ended' where s.state='ending'
 and not exists(select 1 from navrang_private.voice_floors f where f.session_id=s.id and f.phase<>'idle')
 and not exists(select 1 from navrang_private.voice_commands c where c.session_id=s.id and c.operation='revoke' and c.state<>'acked');
 return jsonb_build_object('state','acked');
end;
$ack$;
revoke all on function navrang_private.voice_ack_revoke(uuid,bigint) from public,anon,authenticated;
grant execute on function navrang_private.voice_ack_revoke(uuid,bigint) to service_role;

create or replace function navrang_private.voice_rpc(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $voice$
declare
 actor jsonb;principal_key text;checked_at timestamptz:=clock_timestamp();
 d navrang_private.voice_duty%rowtype;s navrang_private.voice_sessions%rowtype;
 f navrang_private.voice_floors%rowtype;member navrang_private.voice_members%rowtype;
 prior record;op uuid;audience jsonb;revokes jsonb;result jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192 then return jsonb_build_object('error','Invalid voice payload.','status',400);end if;
 actor:=navrang_private.resolve_actor(p_token);
 if actor ? 'error' then return actor;end if;
 if not navrang_private.voice_allowed(actor,'{"type":"everyone"}','') then return jsonb_build_object('error','Approved staff access required.','status',403);end if;
 principal_key:=actor->>'principal';
 -- All state mutations share one short database lock. Never hold it during HTTP.
 perform pg_advisory_xact_lock(hashtextextended('navrang-voice-control',0));
 if p_action not in ('duty-leave','voice-release','voice-broadcast-end','floor-fail') and not navrang_private.voice_ready() then
  return jsonb_build_object('error','Voice provider or expiry worker is not ready.','status',503);
 end if;
 if p_action='duty-join' then
  if coalesce(p->>'installationId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then return jsonb_build_object('error','Invalid installation identifier.','status',400);end if;
  insert into navrang_private.voice_duty as duty(principal,session_hash,installation_id,expires_at)
  values(principal_key,p_token,p->>'installationId',checked_at+interval '60 seconds')
  on conflict(principal,installation_id) do update set session_hash=excluded.session_hash,active=true,expires_at=excluded.expires_at returning * into d;
  insert into navrang_private.voice_sessions(kind,owner_principal,audience) values('channel','', '{"type":"everyone"}')
  on conflict(kind) where kind='channel' and state='active' do nothing;
  select * into s from navrang_private.voice_sessions where kind='channel' and state='active';
  insert into navrang_private.voice_floors(session_id) values(s.id) on conflict do nothing;
  return jsonb_build_object('dutyId',d.id,'expiresAt',d.expires_at,'sessionId',s.id,'transport','NOT_RUN');
 elsif p_action in ('duty-heartbeat','duty-leave') then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token;
  if not found or not d.active or d.expires_at<=checked_at then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  update navrang_private.voice_duty set active=p_action<>'duty-leave',expires_at=case when p_action='duty-leave' then checked_at else checked_at+interval '60 seconds' end where id=d.id;
  if p_action='duty-leave' then perform navrang_private.voice_expire();end if;
  return jsonb_build_object('dutyId',d.id,'active',p_action<>'duty-leave','transport','NOT_RUN');
 elsif p_action in ('voice-broadcast-start','voice-invite') then
  if actor->>'admin'<>'true' then return jsonb_build_object('error','Administrator access required.','status',403);end if;
  select * into d from navrang_private.voice_duty where principal=principal_key and session_hash=p_token and active and expires_at>checked_at order by expires_at desc limit 1;
  if not found then return jsonb_build_object('error','Enable On duty first.','status',403);end if;
  audience:=case when p_action='voice-invite' then jsonb_build_object('type','staff','staffIds',jsonb_build_array((p->>'staffId')::uuid)) else p->'audience' end;
  if audience->>'type' not in ('everyone','roles','staff') or audience is null then return jsonb_build_object('error','Invalid audience.','status',400);end if;
  if p_action='voice-broadcast-start' and exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state in ('active','ending') and request_id is distinct from (p->>'requestId')::uuid) then
   return jsonb_build_object('error','End the current administrator broadcast first.','status',409);
  end if;
  if p_action='voice-broadcast-start' and exists(select 1 from navrang_private.voice_floors where phase in ('granting','revoking')) then
   return jsonb_build_object('error','Wait for the pending relay operation before starting a broadcast.','status',409);
  end if;
  if p_action='voice-invite' and not exists(select 1 from navrang_private.voice_duty duty where duty.principal=p->>'staffId' and duty.active and duty.expires_at>checked_at and
   navrang_private.voice_allowed(navrang_private.resolve_actor(duty.session_hash),'{"type":"everyone"}','')) then
   return jsonb_build_object('error','Selected staff member is not available on duty.','status',409);
  end if;
  insert into navrang_private.voice_sessions(kind,owner_principal,audience,request_id)
  values(case when p_action='voice-invite' then 'private' else 'broadcast' end,principal_key,audience,(p->>'requestId')::uuid)
  on conflict(owner_principal,request_id) do nothing;
  select * into s from navrang_private.voice_sessions where owner_principal=principal_key and request_id=(p->>'requestId')::uuid;
  if s.state<>'active' or s.audience is distinct from audience or s.kind is distinct from (case when p_action='voice-invite' then 'private' else 'broadcast' end) then return jsonb_build_object('error','Request identifier reused.','status',409);end if;
  insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
  insert into navrang_private.voice_floors(session_id) values(s.id) on conflict do nothing;
  if p_action='voice-invite' then return jsonb_build_object('sessionId',s.id,'state','invited','transport','NOT_RUN');end if;
  -- Separate broadcast room, but the administrator first preempts every floor.
  p:=jsonb_build_object('sessionId',s.id,'requestId',p->>'requestId');
  p_action:='floor-prepare';
 elsif p_action='voice-join' then
  select * into d from navrang_private.voice_duty where id=(p->>'dutyId')::uuid and principal=principal_key and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
  if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
  insert into navrang_private.voice_members(session_id,duty_id) values(s.id,d.id) on conflict do nothing;
  select * into member from navrang_private.voice_members where session_id=s.id and duty_id=d.id;
  return jsonb_build_object('sessionId',s.id,'room',s.room,'identity',member.identity,'canPublish',false,'transport','NOT_RUN');
 end if;
 if p_action in ('floor-commit','floor-fail') then
  select floors.* into f from navrang_private.voice_floors floors where operation_id=(p->>'operationId')::uuid and principal=principal_key and phase='granting';
  if not found or f.principal<>principal_key or f.generation is distinct from (p->>'generation')::bigint or f.phase<>'granting' or f.expires_at<=checked_at then return jsonb_build_object('error','Floor operation is stale.','status',409);end if;
  select * into d from navrang_private.voice_duty where id=f.duty_id and session_hash=p_token and active and expires_at>checked_at;
  if not found then return jsonb_build_object('error','Duty session expired.','status',403);end if;
  update navrang_private.voice_commands set state=case when p_action='floor-commit' then 'acked'
   when operation='grant' and not coalesce((p->>'ambiguousGrant')::boolean,false) then 'acked' else 'failed' end,
   acked_at=case when p_action='floor-commit' then checked_at end where operation_id=f.operation_id;
  if p_action='floor-commit' then
   update navrang_private.voice_floors set phase='idle',principal=null,identity=null,duty_id=null,lease_id=null,expires_at=null
   where operation_id=f.operation_id and session_id<>f.session_id and phase='revoking';
  end if;
  update navrang_private.voice_floors set phase=case when p_action='floor-commit' then 'active' else 'revoking' end where session_id=f.session_id returning * into f;
  if p_action='floor-fail' then
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
   select f.operation_id,f.session_id,room,f.identity,f.generation,'revoke' from navrang_private.voice_sessions where id=f.session_id on conflict do nothing;
   update navrang_private.voice_sessions set state='ending' where id=f.session_id and kind='broadcast';
  end if;
  return jsonb_build_object('state',f.phase,'sessionId',f.session_id,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'transport','NOT_RUN');
 end if;
 select * into s from navrang_private.voice_sessions where id=(p->>'sessionId')::uuid and state='active';
 if not found or not navrang_private.voice_allowed(actor,s.audience,s.owner_principal) then return jsonb_build_object('error','Voice session is not available to this account.','status',403);end if;
 select members.* into member from navrang_private.voice_members members join navrang_private.voice_duty duty on duty.id=members.duty_id
 where members.session_id=s.id and duty.principal=principal_key and duty.session_hash=p_token and duty.active and duty.expires_at>checked_at order by duty.expires_at desc limit 1;
 if not found then return jsonb_build_object('error','Join the voice session first.','status',403);end if;
 select * into f from navrang_private.voice_floors where session_id=s.id for update;
 if p_action='floor-prepare' then
  if exists(select 1 from navrang_private.voice_sessions where kind='broadcast' and state='active' and id<>s.id) then return jsonb_build_object('error','Administrator broadcast has priority.','status',409);end if;
  if f.request_id=(p->>'requestId')::uuid and f.principal=principal_key and f.phase in ('active','granting') then
   if f.expires_at<=checked_at then return jsonb_build_object('error','Floor request expired.','status',409);end if;
  else
   if f.phase in ('revoking','granting') then return jsonb_build_object('error','Previous floor operation awaits relay confirmation.','status',409);end if;
   if f.phase='active' and f.expires_at>checked_at and actor->>'admin'<>'true' then return jsonb_build_object('error','Another staff member is speaking.','status',409);end if;
   op:=gen_random_uuid();
   for prior in select floors.*,sessions.room from navrang_private.voice_floors floors join navrang_private.voice_sessions sessions on sessions.id=floors.session_id
    where floors.phase<>'idle' and (floors.session_id=s.id or (s.kind='broadcast' and actor->>'admin'='true'))
   loop
    insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation)
    values(op,prior.session_id,prior.room,prior.identity,prior.generation+1,'revoke');
    update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=prior.session_id;
   end loop;
   update navrang_private.voice_floors set generation=generation+1,phase='granting',principal=principal_key,identity=member.identity,duty_id=member.duty_id,
    lease_id=gen_random_uuid(),expires_at=checked_at+interval '15 seconds',operation_id=op,request_id=(p->>'requestId')::uuid where session_id=s.id returning * into f;
   insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation) values(op,s.id,s.room,member.identity,f.generation,'grant');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('room',room,'identity',identity,'generation',generation) order by id),'[]'::jsonb) into revokes from navrang_private.voice_commands where operation_id=f.operation_id and operation='revoke';
  return jsonb_build_object('operationId',f.operation_id,'state',f.phase,'sessionId',s.id,'room',s.room,'identity',member.identity,'generation',f.generation,'leaseId',f.lease_id,'expiresAt',f.expires_at,'revoke',revokes,'transport','NOT_RUN');
 elsif p_action='voice-renew' then
  if f.phase<>'active' or f.principal<>principal_key or f.duty_id<>member.duty_id or f.lease_id is distinct from (p->>'leaseId')::uuid or f.expires_at<=checked_at then return jsonb_build_object('error','Floor lease expired.','status',409);end if;
  update navrang_private.voice_floors set expires_at=checked_at+interval '15 seconds' where session_id=s.id returning * into f;
  return jsonb_build_object('state',f.phase,'leaseId',f.lease_id,'expiresAt',f.expires_at,'generation',f.generation);
 elsif p_action in ('voice-release','voice-broadcast-end') then
  if p_action='voice-broadcast-end' and (actor->>'admin'<>'true' or s.kind<>'broadcast') then return jsonb_build_object('error','Administrator broadcast required.','status',403);end if;
  if f.phase='idle' then
   if p_action='voice-broadcast-end' then update navrang_private.voice_sessions set state='ending' where id=s.id;perform navrang_private.voice_expire();end if;
   return jsonb_build_object('state','idle');
  end if;
  if f.principal<>principal_key or (p_action='voice-release' and f.lease_id is distinct from (p->>'leaseId')::uuid) then return jsonb_build_object('error','Floor belongs to another session.','status',403);end if;
  op:=gen_random_uuid();update navrang_private.voice_floors set phase='revoking',generation=generation+1,operation_id=op where session_id=s.id returning * into f;
  insert into navrang_private.voice_commands(operation_id,session_id,room,identity,generation,operation) values(op,s.id,s.room,f.identity,f.generation,'revoke');
  if p_action='voice-broadcast-end' then update navrang_private.voice_sessions set state='ending' where id=s.id;perform navrang_private.voice_expire();end if;
  return jsonb_build_object('state','revoking','operationId',op,'transport','NOT_RUN');
 end if;
 return jsonb_build_object('error','Unknown voice action.','status',400);
exception when invalid_text_representation or numeric_value_out_of_range then
 return jsonb_build_object('error','Invalid voice identifiers.','status',400);
end;
$voice$;
revoke all on function navrang_private.voice_rpc(text,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.voice_rpc(text,jsonb,text) to service_role;

-- END VOICE STATE V080

-- BEGIN NOTIFICATIONS V080
-- Additive notification center/outbox. Requires communications-v080.sql.
-- Deployment stays disabled until independently verified provider/worker setup.
create sequence if not exists navrang_private.notification_revision_seq as bigint;
create table if not exists navrang_private.notification_config(singleton boolean primary key default true check(singleton),center_enabled boolean not null default false,delivery_enabled boolean not null default false);
insert into navrang_private.notification_config(singleton) values(true) on conflict do nothing;
alter table navrang_private.notification_config add column if not exists expired_failure_total bigint not null default 0;
create table if not exists navrang_private.notification_events(
 id uuid primary key default gen_random_uuid(),event_key text not null unique,kind text not null,actor text not null,
 title text not null check(length(title)<=100),body text not null check(length(body)<=1000),destination text not null check(destination in ('notifications','reports','admin','account','voice')),
 audience jsonb not null default '{"type":"everyone"}',payload jsonb not null,aggregate_count integer not null default 1,
 live boolean not null default false,ended_at timestamptz,at timestamptz not null default clock_timestamp()
);
create table if not exists navrang_private.notification_sources(source_key text primary key,event_id uuid not null references navrang_private.notification_events(id) on delete cascade,at timestamptz not null default clock_timestamp());
create table if not exists navrang_private.notification_centers(
 principal text primary key,revision bigint not null default 0,dashboard_hidden boolean not null default false,
 live_event_id uuid references navrang_private.notification_events(id) on delete set null
);
create table if not exists navrang_private.notification_items(
 principal text not null,event_id uuid not null references navrang_private.notification_events(id) on delete cascade,
 revision bigint not null,read boolean not null default false,primary key(principal,event_id)
);
create index if not exists notification_items_recent on navrang_private.notification_items(principal,revision desc,event_id);
create table if not exists navrang_private.notification_devices(
 installation_id text primary key,binding_id uuid not null unique,principal text not null,
 session_hash text not null references navrang_private.sessions(hash) on delete cascade,
 provider_type text not null check(provider_type in ('fid','legacyToken')),provider_value text not null check(length(provider_value) between 1 and 4096),
 unlink_hash text not null check(unlink_hash ~ '^[a-f0-9]{64}$'),at timestamptz not null default clock_timestamp()
);
create table if not exists navrang_private.notification_outbox(
 id bigint generated always as identity primary key,event_id uuid not null references navrang_private.notification_events(id) on delete cascade,
 principal text not null,binding_id uuid not null,revision bigint not null,
 status text not null default 'queued' check(status in ('queued','leased','accepted','failed','cancelled')),
 attempts integer not null default 0,next_attempt timestamptz not null default clock_timestamp(),lease_id uuid,lease_until timestamptz,
 error_code text,at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(event_id,binding_id,revision)
);
create index if not exists notification_outbox_due on navrang_private.notification_outbox(status,next_attempt);
create table if not exists navrang_private.notification_requests(
 principal text not null,request_id uuid not null,payload jsonb not null,event_id uuid not null references navrang_private.notification_events(id) on delete cascade,
 result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(principal,request_id)
);
do $acl$
declare object_name text;
begin
 foreach object_name in array array['notification_config','notification_events','notification_sources','notification_centers','notification_items','notification_devices','notification_outbox','notification_requests'] loop
  execute format('alter table navrang_private.%I enable row level security',object_name);
  execute format('revoke all on navrang_private.%I from public,anon,authenticated',object_name);
  execute format('grant select,insert,update,delete on navrang_private.%I to service_role',object_name);
 end loop;
end;
$acl$;
revoke all on sequence navrang_private.notification_revision_seq,navrang_private.notification_outbox_id_seq from public,anon,authenticated;
grant usage,select on sequence navrang_private.notification_revision_seq,navrang_private.notification_outbox_id_seq to service_role;

create or replace function navrang_private.resolve_communication_principal(p_principal text)
returns jsonb language plpgsql security invoker set search_path='' as $principal$
declare staff navrang_private.checkers%rowtype; rev bigint; faculty boolean:=false; ready boolean; active_now boolean;
begin
 select revision into rev from navrang_private.communication_capability_revisions where principal=p_principal;
 if not found then return jsonb_build_object('active',false);end if;
 if p_principal='admin' then return jsonb_build_object('principal','admin','admin',true,'scanner',false,'helpdesk',false,'faculty',false,'active',true,'capabilityRevision',rev);end if;
 if p_principal !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('active',false);end if;
 select * into staff from navrang_private.checkers where id=p_principal::uuid;
 if not found then return jsonb_build_object('active',false);end if;
 active_now:=staff.active and (staff.access_expires_at is null or staff.access_expires_at>clock_timestamp());
 ready:=staff.method<>'google' or staff.name_confirmed;
 select coalesce(enabled,false) into faculty from navrang_private.report_grants where checker_id=staff.id;
 return jsonb_build_object('principal',p_principal,'admin',false,'active',active_now,'capabilityRevision',rev,
  'scanner',active_now and ready and staff.scanner_enabled and staff.selected_station='checker',
  'helpdesk',active_now and ready and staff.helpdesk_enabled and staff.selected_station='helpdesk',
  'faculty',active_now and staff.method='google' and staff.google_id is not null and staff.name_confirmed and not staff.scanner_enabled and not staff.helpdesk_enabled and coalesce(faculty,false));
end;
$principal$;

create or replace function navrang_private.notification_audience_matches(p_audience jsonb,p_principal text)
returns boolean language plpgsql security invoker set search_path='' as $audience$
declare actor jsonb:=navrang_private.resolve_communication_principal(p_principal);
begin
 if actor->>'active' is distinct from 'true' then return false;end if;
 if p_audience->>'type'='everyone' then return true;end if;
 if p_audience->>'type'='staff' then return actor->>'admin'<>'true' and coalesce(p_audience->'staffIds' ? p_principal,false);end if;
 if p_audience->>'type'='roles' then
  return (actor->>'admin'='true' and p_audience->'roles' ? 'administrator') or
   (actor->>'scanner'='true' and p_audience->'roles' ? 'checker') or
   (actor->>'helpdesk'='true' and p_audience->'roles' ? 'helpdesk') or
   (actor->>'faculty'='true' and p_audience->'roles' ? 'faculty');
 end if;
 return false;
end;
$audience$;

create or replace function navrang_private.notification_event_allowed(p_event uuid,p_principal text)
returns boolean language plpgsql security invoker set search_path='' as $allowed$
declare event_row navrang_private.notification_events%rowtype; actor jsonb:=navrang_private.resolve_communication_principal(p_principal);
begin
 select * into event_row from navrang_private.notification_events where id=p_event;
 if not found then return false;end if;
 if event_row.kind='access-change' then return p_principal='admin' or event_row.actor=p_principal;end if;
 if actor->>'active' is distinct from 'true' then return false;end if;
 if event_row.kind in ('ticket-activity','helpdesk-activity') then return p_principal='admin';end if;
 if event_row.kind in ('report-prepared','report-outcome') then return p_principal='admin' or (event_row.actor=p_principal and actor->>'faculty'='true');end if;
 return navrang_private.notification_audience_matches(event_row.audience,p_principal);
end;
$allowed$;

create or replace function navrang_private.append_notification_event(e jsonb,recipients text[])
returns uuid language plpgsql security invoker set search_path='' as $append$
declare created_id uuid; selected_key text; recipient text; rev bigint; aggregate_size integer; live_item boolean:=coalesce((e->>'live')::boolean,false);
begin
 if not exists(select 1 from navrang_private.notification_config where singleton and center_enabled) then return null;end if;
 if coalesce(e->>'key','')='' or length(e->>'key')>256 or e->>'kind' not in ('announcement','ticket-activity','helpdesk-activity','access-change','report-prepared','report-outcome','update') then raise exception 'Invalid internal notification event';end if;
 perform pg_advisory_xact_lock(hashtextextended(e->>'key',80));
 select source.event_id into created_id from navrang_private.notification_sources source where source.source_key=e->>'key';
 if found then return created_id;end if;
 selected_key:=coalesce(nullif(e->>'aggregateKey',''),e->>'key');
 perform pg_advisory_xact_lock(hashtextextended(selected_key,81));
 select id into created_id from navrang_private.notification_events where notification_events.event_key=selected_key;
 if found and e ? 'aggregateKey' then
  update navrang_private.notification_events set aggregate_count=aggregate_count+1,at=clock_timestamp(),body=(aggregate_count+1)::text||' ticket checks recorded.' where id=created_id returning aggregate_count into aggregate_size;
 elsif found then raise exception 'Notification event key reused with a different source';
 else
  insert into navrang_private.notification_events(event_key,kind,actor,title,body,destination,audience,payload,live)
  values(selected_key,e->>'kind',e->>'actor',left(e->>'title',100),left(e->>'body',1000),e->>'destination',coalesce(e->'audience','{"type":"everyone"}'),e-'key'-'aggregateKey',live_item)
  returning id into created_id;
 end if;
 insert into navrang_private.notification_sources(source_key,event_id) values(e->>'key',created_id);
 for recipient in select distinct value from unnest(recipients) value order by value loop
  perform pg_advisory_xact_lock(hashtextextended(recipient,82));
  rev:=nextval('navrang_private.notification_revision_seq');
  insert into navrang_private.notification_centers(principal,revision,live_event_id) values(recipient,rev,case when live_item then created_id else null end)
  on conflict(principal) do update set revision=excluded.revision,live_event_id=case when live_item then excluded.live_event_id else notification_centers.live_event_id end;
  if not live_item then
   insert into navrang_private.notification_items(principal,event_id,revision) values(recipient,created_id,rev)
   on conflict(principal,event_id) do update set revision=excluded.revision,read=false;
   delete from navrang_private.notification_items victim where victim.principal=recipient and victim.event_id in
    (select item.event_id from navrang_private.notification_items item where item.principal=recipient order by revision desc,event_id desc offset 5);
  end if;
  update navrang_private.notification_outbox queue set status='cancelled',updated_at=clock_timestamp()
   where queue.principal=recipient and queue.status in ('queued','leased') and not exists(select 1 from navrang_private.notification_items item where item.principal=recipient and item.event_id=queue.event_id)
    and not exists(select 1 from navrang_private.notification_centers center where center.principal=recipient and center.live_event_id=queue.event_id);
  if e ? 'aggregateKey' then
   update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp()
    where notification_outbox.event_id=created_id and principal=recipient and status in ('queued','leased');
  end if;
  insert into navrang_private.notification_outbox(event_id,principal,binding_id,revision,next_attempt)
   select created_id,recipient,device.binding_id,rev,case when e ? 'aggregateKey' then clock_timestamp()+interval '10 seconds' else clock_timestamp() end
   from navrang_private.notification_devices device where device.principal=recipient
   on conflict do nothing;
 end loop;
 return created_id;
end;
$append$;

create or replace function navrang_private.notification_preview(p_template jsonb,p_audience jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $preview$
declare recipients jsonb; fingerprint text;
begin
 select coalesce(jsonb_agg(jsonb_build_object('principal',principal,'revision',actor->'capabilityRevision') order by principal),'[]') into recipients
 from (select principal,navrang_private.resolve_communication_principal(principal) actor from navrang_private.communication_capability_revisions) actors
 where navrang_private.notification_audience_matches(p_audience,principal);
 fingerprint:=encode(extensions.digest(jsonb_build_object('template',p_template,'audience',p_audience,'recipients',recipients)::text,'sha256'),'hex');
 return jsonb_build_object('recipientCount',jsonb_array_length(recipients),'previewHash',fingerprint,'recipientIds',
  coalesce((select jsonb_agg(value->>'principal' order by value->>'principal') from jsonb_array_elements(recipients) value),'[]'));
end;
$preview$;

create or replace function navrang_private.notification_rpc(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $rpc$
declare actor jsonb; principal_key text; center navrang_private.notification_centers%rowtype;
 previous navrang_private.notification_devices%rowtype; existing_request navrang_private.notification_requests%rowtype;
 preview jsonb; result jsonb; items jsonb; ids jsonb; totals jsonb; dashboard jsonb; created_id uuid; live_row navrang_private.notification_events%rowtype;
 recipients text[]; new_proof text; rev bigint; removed integer; request_key text; event_payload jsonb;
begin
 -- A proof can only delete its exact binding. It grants no account/feed access.
 if p_action='notifications-unregister' then
  delete from navrang_private.notification_devices where installation_id=p->>'installationId' and binding_id=(p->>'bindingId')::uuid
   and unlink_hash=encode(extensions.digest(coalesce(p->>'unlinkProof',''),'sha256'),'hex');
  get diagnostics removed=row_count;
  if removed=1 then
   update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp() where binding_id=(p->>'bindingId')::uuid and status in ('queued','leased');
  end if;
  return jsonb_build_object('removed',removed=1);
 end if;
 actor:=navrang_private.resolve_actor(p_token);if actor ? 'error' then return actor;end if;
 principal_key:=actor->>'principal';
 if not exists(select 1 from navrang_private.notification_config where singleton and center_enabled) then return jsonb_build_object('error','Notification center is not configured.','status',503);end if;
 insert into navrang_private.notification_centers(principal) values(principal_key) on conflict do nothing;
 if p_action='notifications-feed' then
  select * into center from navrang_private.notification_centers where principal=principal_key;
  select coalesce(jsonb_agg((jsonb_build_object('id',event.id,'revision',item.revision,'kind',event.kind,'title',event.title,'body',event.body,'at',event.at,'read',item.read,'destination',event.destination)||
   jsonb_strip_nulls(jsonb_build_object('templateType',event.payload#>'{template,type}','urgency',event.payload#>'{template,urgency}',
    'meeting',case when event.payload#>>'{template,type}'='meeting' and ((event.payload->'template') ? 'meetingLocation' or (event.payload->'template') ? 'meetingTime') then
     jsonb_strip_nulls(jsonb_build_object('location',event.payload#>'{template,meetingLocation}','time',event.payload#>'{template,meetingTime}')) else null end))) order by item.revision desc,event.id desc),'[]'),
   coalesce(jsonb_agg(event.id::text order by item.revision desc,event.id desc),'[]') into items,ids
  from navrang_private.notification_items item join navrang_private.notification_events event on event.id=item.event_id
  where item.principal=principal_key and navrang_private.notification_event_allowed(event.id,principal_key);
  dashboard:=null;
  if actor->>'active'='true' then
   if actor->>'admin'='true' or actor->>'faculty'='true' then
    result:=public.navrang_reports('summary','{}',p_token);
    select coalesce(jsonb_object_agg(key,value),'{}') into totals from jsonb_each(coalesce(result->'stats','{}'))
     where key in ('registered','eligible','blocked','registeredAttended','eligibleRegisteredAttended','noShow','attended','organizerConfirmed','unmatchedAttendees','serverIssues','issueTickets','duplicateAttempts','pendingHelpDesk') and jsonb_typeof(value)='number';
   elsif actor->>'scanner'='true' or actor->>'helpdesk'='true' then
    totals:=jsonb_build_object('ownScans',(select count(*) from navrang_private.admissions where not test_fixture and checker_id=principal_key::uuid),'totalEntries',(select count(*) from navrang_private.admissions where not test_fixture));
   else totals:='{}';end if;
   dashboard:=jsonb_build_object('revision',center.revision,'generatedAt',clock_timestamp(),'status','live','totals',totals,'hidden',center.dashboard_hidden);
   if actor->>'admin'='true' then
    dashboard:=dashboard||jsonb_build_object('delivery',jsonb_build_object(
     'queued',(select count(*) from navrang_private.notification_outbox where status in ('queued','leased')),
     'failed',(select count(*) from navrang_private.notification_outbox where status='failed'),
     'providerAccepted',(select count(*) from navrang_private.notification_outbox where status='accepted'),
     'expiredFailures',(select expired_failure_total from navrang_private.notification_config where singleton)));
   end if;
   select * into live_row from navrang_private.notification_events where id=center.live_event_id and ended_at is null and navrang_private.notification_event_allowed(id,principal_key);
   if found then dashboard:=dashboard||jsonb_build_object('announcement',jsonb_build_object('id',live_row.id,'title',live_row.title,'body',live_row.body,'at',live_row.at)||
    jsonb_strip_nulls(jsonb_build_object('templateType',live_row.payload#>'{template,type}','urgency',live_row.payload#>'{template,urgency}',
     'meeting',case when live_row.payload#>>'{template,type}'='meeting' then jsonb_strip_nulls(jsonb_build_object('location',live_row.payload#>'{template,meetingLocation}','time',live_row.payload#>'{template,meetingTime}')) else null end)));end if;
  end if;
  return jsonb_build_object('revision',center.revision,'serverTime',clock_timestamp(),'items',items,'activeIds',ids,'dashboard',dashboard);
 end if;
 if p_action='notifications-read' then
  update navrang_private.notification_items set read=true where principal=principal_key and event_id=(p->>'id')::uuid and navrang_private.notification_event_allowed(event_id,principal_key) returning revision into rev;
  if found then
   update navrang_private.notification_centers set revision=nextval('navrang_private.notification_revision_seq') where principal=principal_key returning revision into rev;
   return jsonb_build_object('read',true,'revision',rev);
  end if;
  return jsonb_build_object('read',false,'revision',(select revision from navrang_private.notification_centers where principal=principal_key));
 end if;
 if actor->>'active' is distinct from 'true' then return jsonb_build_object('error','Administrator approval is required.','status',403);end if;
 if p_action='notifications-dashboard' then
  update navrang_private.notification_centers set dashboard_hidden=(p->>'hidden')::boolean,revision=nextval('navrang_private.notification_revision_seq') where principal=principal_key returning revision into rev;
  return jsonb_build_object('hidden',(p->>'hidden')::boolean,'revision',rev);
 end if;
 if p_action='notifications-device' then
  perform pg_advisory_xact_lock(hashtextextended(p->>'installationId',83));
  select * into previous from navrang_private.notification_devices where installation_id=p->>'installationId' for update;
  if found and previous.principal<>principal_key and previous.unlink_hash<>encode(extensions.digest(coalesce(p->>'previousUnlinkProof',''),'sha256'),'hex') then
   return jsonb_build_object('error','The previous installation binding must be unlinked first.','status',409);
  end if;
  new_proof:=encode(extensions.gen_random_bytes(32),'hex');
  update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp() where binding_id=previous.binding_id and status in ('queued','leased');
  insert into navrang_private.notification_devices(installation_id,binding_id,principal,session_hash,provider_type,provider_value,unlink_hash)
  values(p->>'installationId',(p->>'bindingId')::uuid,principal_key,p_token,p#>>'{providerTarget,type}',p#>>'{providerTarget,value}',encode(extensions.digest(new_proof,'sha256'),'hex'))
  on conflict(installation_id) do update set binding_id=excluded.binding_id,principal=excluded.principal,session_hash=excluded.session_hash,provider_type=excluded.provider_type,provider_value=excluded.provider_value,unlink_hash=excluded.unlink_hash,at=clock_timestamp();
  return jsonb_build_object('registered',true,'bindingId',p->>'bindingId','unlinkProof',new_proof);
 end if;
 if actor->>'admin' is distinct from 'true' then return jsonb_build_object('error','Administrator access required.','status',403);end if;
 if p_action='notifications-preview' then return navrang_private.notification_preview(p->'template',p->'audience')-'recipientIds';end if;
 if p_action='notifications-send' then
  perform pg_advisory_xact_lock(hashtextextended('announcement:'||principal_key||':'||(p->>'requestId'),84));
  select * into existing_request from navrang_private.notification_requests where principal=principal_key and request_id=(p->>'requestId')::uuid;
  if found then
   if existing_request.payload<>p then return jsonb_build_object('error','Request ID was already used with different content.','status',409);end if;
   return existing_request.result||jsonb_build_object('replayed',true);
  end if;
  preview:=navrang_private.notification_preview(p->'template',p->'audience');
  if preview->>'previewHash' is distinct from p->>'previewHash' then return (preview-'recipientIds')||jsonb_build_object('previewChanged',true,'error','Recipients changed. Review the updated preview.','status',409);end if;
  select array_agg(value order by value) into recipients from jsonb_array_elements_text(preview->'recipientIds') value;
  event_payload:=jsonb_build_object('key','announcement:'||principal_key||':'||(p->>'requestId'),'kind','announcement','actor',principal_key,'title',p#>>'{template,title}','body',coalesce(p#>>'{template,body}',''),'destination','notifications','audience',p->'audience','template',p->'template','live',p#>>'{template,type}'='live-broadcast');
  created_id:=navrang_private.append_notification_event(event_payload,coalesce(recipients,array[]::text[]));
  result:=jsonb_build_object('sent',true,'id',created_id,'recipientCount',preview->'recipientCount');
  insert into navrang_private.notification_requests(principal,request_id,payload,event_id,result) values(principal_key,(p->>'requestId')::uuid,p,created_id,result);
  return result;
 end if;
 if p_action='notifications-end' then
  update navrang_private.notification_events set ended_at=coalesce(ended_at,clock_timestamp()) where id=(p->>'id')::uuid and live returning id into created_id;
  if not found then return jsonb_build_object('error','Live announcement was not found.','status',404);end if;
  update navrang_private.notification_centers set live_event_id=null,revision=nextval('navrang_private.notification_revision_seq') where live_event_id=created_id;
  update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp() where notification_outbox.event_id=created_id and status in ('queued','leased');
  return jsonb_build_object('ended',true);
 end if;
 return jsonb_build_object('error','Unknown notification action.','status',400);
end;
$rpc$;

create or replace function navrang_private.notification_attempt_committed()
returns trigger language plpgsql security invoker set search_path='' as $attempt$
declare display_name text:='Administrator';
begin
 if not new.test_fixture then
  if new.actor<>'admin' and new.actor ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   select coalesce(left(name,40),'Staff member') into display_name from navrang_private.checkers where id=new.actor::uuid;
  end if;
  perform navrang_private.append_notification_event(jsonb_build_object('key','attempt:'||new.actor||':'||new.request_id,
   'aggregateKey','attempt-window:'||new.actor||':'||floor(extract(epoch from new.at)/10)::text,'kind','ticket-activity','actor',new.actor,
   'title','Gate activity · '||coalesce(display_name,'Staff member'),'body','1 ticket check recorded.','destination','admin'),array['admin']);
 end if;
 return new;
end;
$attempt$;
drop trigger if exists navrang_notification_attempt on navrang_private.attempts;
create trigger navrang_notification_attempt after insert on navrang_private.attempts for each row execute function navrang_private.notification_attempt_committed();

create or replace function navrang_private.notification_helpdesk_committed()
returns trigger language plpgsql security invoker set search_path='' as $desk$
begin
 perform navrang_private.append_notification_event(jsonb_build_object('key','helpdesk-audit:'||new.id,'kind','helpdesk-activity','actor',new.actor,'title','Help Desk activity','body',left(new.actor_name,40)||' recorded Help Desk action: '||new.action||'.','destination','admin'),array['admin']);
 return new;
end;
$desk$;
drop trigger if exists navrang_notification_helpdesk on navrang_private.helpdesk_audit;
create trigger navrang_notification_helpdesk after insert on navrang_private.helpdesk_audit for each row execute function navrang_private.notification_helpdesk_committed();

create or replace function navrang_private.notification_access_changed()
returns trigger language plpgsql security invoker set search_path='' as $access$
declare target text; rev bigint; display_name text;
begin
 if tg_table_name='checkers' then
  if row(old.active,old.scanner_enabled,old.helpdesk_enabled,old.selected_station,old.access_expires_at) is not distinct from row(new.active,new.scanner_enabled,new.helpdesk_enabled,new.selected_station,new.access_expires_at) then return new;end if;
  target:=new.id::text;
 else
  if tg_op='UPDATE' and old.enabled is not distinct from new.enabled then return new;end if;
  target:=new.checker_id::text;
 end if;
 select left(name,40) into display_name from navrang_private.checkers where id=target::uuid;
 select revision into rev from navrang_private.communication_capability_revisions where principal=target;
 perform navrang_private.append_notification_event(jsonb_build_object('key','access:'||target||':'||rev||':'||tg_table_name,'kind','access-change','actor',target,'title','Staff access updated','body',coalesce(display_name,'Staff member')||' · Assigned access or station changed. Refresh your account.','destination','account'),array['admin',target]);
 return new;
end;
$access$;
drop trigger if exists navrang_notification_staff_access on navrang_private.checkers;
create trigger navrang_notification_staff_access after update on navrang_private.checkers for each row execute function navrang_private.notification_access_changed();
drop trigger if exists navrang_notification_report_access on navrang_private.report_grants;
create trigger navrang_notification_report_access after insert or update on navrang_private.report_grants for each row execute function navrang_private.notification_access_changed();

-- The report-operation module installs a no-op hook first; this reviewed
-- replacement consumes metadata only and never copies report rows/contents.
create or replace function navrang_private.report_operation_event(p_event jsonb)
returns void language plpgsql security invoker set search_path='' as $report_event$
declare metadata jsonb:=p_event; actor jsonb; principal_key text:=metadata->>'actor'; recipients text[]:=array['admin']; outcome text:=metadata->>'outcome'; actor_name text; event_kind text;
begin
 if jsonb_typeof(metadata)<>'object' or metadata->>'operationId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or metadata->>'kind' not in ('all','attended','absent','blocked','issues','resolved','unresolved','duplicates','activity','helpdesk','pending','corrections','summary')
  or metadata->>'format' not in ('csv','xlsx','pdf') or outcome not in ('prepared','initiated','saved','cancelled','failed') then raise exception 'Invalid report notification metadata';end if;
 actor:=navrang_private.resolve_communication_principal(principal_key);
 if actor->>'active' is distinct from 'true' or (actor->>'admin' is distinct from 'true' and actor->>'faculty' is distinct from 'true') then return;end if;
 if outcome='saved' and metadata->>'deviceReported' is distinct from 'true' then raise exception 'Saved report requires device-reported receipt';end if;
 actor_name:='Administrator';
 if principal_key<>'admin' then
  select left(name,40) into actor_name from navrang_private.checkers where id=principal_key::uuid;
  if outcome<>'prepared' then recipients:=array['admin',principal_key];end if;
 end if;
 event_kind:=case when outcome='prepared' then 'report-prepared' else 'report-outcome' end;
 perform navrang_private.append_notification_event(jsonb_build_object('key','report-operation:'||(metadata->>'operationId')||':'||outcome,
  'kind',event_kind,'actor',principal_key,'title','Report download update','body',actor_name||' · '||(metadata->>'kind')||' · '||
  case when outcome='saved' then 'device-reported saved' when outcome='initiated' then 'download initiated' else outcome end||'.','destination','reports'),recipients);
end;
$report_event$;

create or replace function navrang_private.prune_notification_operational()
returns jsonb language plpgsql security invoker set search_path='' as $retention$
declare failures bigint; deliveries bigint; events bigint; cutoff timestamptz:=clock_timestamp()-interval '7 days';
begin
 select count(*) into failures from navrang_private.notification_outbox where at<cutoff and status in ('queued','leased','failed');
 update navrang_private.notification_config set expired_failure_total=expired_failure_total+failures where singleton;
 delete from navrang_private.notification_outbox where at<cutoff;get diagnostics deliveries=row_count;
 -- Preserve each recipient's five current items and active pinned card. Only
 -- unreferenced operational history is pruned; business audits are unrelated.
 delete from navrang_private.notification_events event where event.at<cutoff
  and not exists(select 1 from navrang_private.notification_items item where item.event_id=event.id)
  and not exists(select 1 from navrang_private.notification_centers center where center.live_event_id=event.id)
  and not exists(select 1 from navrang_private.notification_outbox queue where queue.event_id=event.id);
 get diagnostics events=row_count;
 return jsonb_build_object('removedDeliveries',deliveries,'removedEvents',events,'expiredFailures',failures);
end;
$retention$;

create or replace function navrang_private.claim_notification_deliveries(p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path='' as $claim$
declare job navrang_private.notification_outbox%rowtype; jobs jsonb:='[]'; claim_id uuid;
begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Invalid delivery batch size';end if;
 perform navrang_private.prune_notification_operational();
 if not exists(select 1 from navrang_private.notification_config where singleton and center_enabled and delivery_enabled) then return jobs;end if;
 for job in select * from navrang_private.notification_outbox where
   (status='queued' and next_attempt<=clock_timestamp()) or (status='leased' and lease_until<=clock_timestamp())
   order by id for update skip locked limit p_limit loop
  claim_id:=gen_random_uuid();
  update navrang_private.notification_outbox set status='leased',lease_id=claim_id,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=clock_timestamp() where id=job.id;
  jobs:=jobs||jsonb_build_array(jsonb_build_object('id',job.id,'leaseId',claim_id,'revision',job.revision));
 end loop;
 return jobs;
end;
$claim$;

create or replace function navrang_private.check_notification_delivery(p_id bigint,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $check$
declare job navrang_private.notification_outbox%rowtype; device navrang_private.notification_devices%rowtype; actor jsonb; allowed_now boolean;
begin
 if not exists(select 1 from navrang_private.notification_config where singleton and center_enabled and delivery_enabled) then return jsonb_build_object('allowed',false,'reason','disabled');end if;
 select * into job from navrang_private.notification_outbox where id=p_id and lease_id=p_lease and status='leased' and lease_until>clock_timestamp() for update;
 if not found then return jsonb_build_object('allowed',false,'reason','lease-unavailable');end if;
 select * into device from navrang_private.notification_devices where binding_id=job.binding_id and principal=job.principal;
 allowed_now:=found;
 if allowed_now then
  actor:=navrang_private.resolve_actor(device.session_hash);
  allowed_now:=not (actor ? 'error') and actor->>'principal'=job.principal and navrang_private.notification_event_allowed(job.event_id,job.principal)
   and (exists(select 1 from navrang_private.notification_items item where item.principal=job.principal and item.event_id=job.event_id)
    or exists(select 1 from navrang_private.notification_centers center join navrang_private.notification_events event on event.id=center.live_event_id where center.principal=job.principal and center.live_event_id=job.event_id and event.ended_at is null));
 end if;
 if not allowed_now then
  update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp(),error_code='access-or-binding-changed' where id=p_id;
  return jsonb_build_object('allowed',false,'reason','access-or-binding-changed');
 end if;
 return jsonb_build_object('allowed',true,'eventId',job.event_id,'bindingId',job.binding_id,'revision',job.revision,
  'providerTarget',jsonb_build_object('type',device.provider_type,'value',device.provider_value));
end;
$check$;

create or replace function navrang_private.finish_notification_delivery(p_id bigint,p_lease uuid,p_outcome text)
returns jsonb language plpgsql security invoker set search_path='' as $finish$
declare job navrang_private.notification_outbox%rowtype; retry_seconds integer;
begin
 if p_outcome not in ('accepted','retry','invalid','cancelled') then raise exception 'Invalid delivery outcome';end if;
 select * into job from navrang_private.notification_outbox where id=p_id and lease_id=p_lease and lease_until>clock_timestamp() and status in ('leased','cancelled') for update;
 if not found then return jsonb_build_object('completed',false);end if;
 if job.status='cancelled' then return jsonb_build_object('completed',p_outcome='cancelled');end if;
 if p_outcome='invalid' then
  delete from navrang_private.notification_devices where binding_id=job.binding_id;
  update navrang_private.notification_outbox set status='cancelled',error_code='invalid-target',updated_at=clock_timestamp() where binding_id=job.binding_id and status in ('queued','leased');
  update navrang_private.notification_outbox set status='failed',error_code='invalid-target',updated_at=clock_timestamp() where id=p_id;
 elsif p_outcome='retry' then
  retry_seconds:=least(3600,power(2,least(job.attempts,10))::integer*5);
  update navrang_private.notification_outbox set status=case when attempts>=8 then 'failed' else 'queued' end,next_attempt=clock_timestamp()+make_interval(secs=>retry_seconds),lease_id=null,lease_until=null,error_code='provider-unavailable',updated_at=clock_timestamp() where id=p_id;
 else
  update navrang_private.notification_outbox set status=p_outcome,error_code=null,updated_at=clock_timestamp() where id=p_id;
 end if;
 return jsonb_build_object('completed',true);
end;
$finish$;

-- Invoker functions are server-only, including internal hooks and helpers.
do $functions$
declare proc record;
begin
 for proc in select oid::regprocedure signature from pg_proc where pronamespace='navrang_private'::regnamespace and proname in
  ('resolve_communication_principal','notification_audience_matches','notification_event_allowed','append_notification_event','notification_preview','notification_rpc','notification_attempt_committed','notification_helpdesk_committed','notification_access_changed','report_operation_event','prune_notification_operational','claim_notification_deliveries','check_notification_delivery','finish_notification_delivery') loop
  execute format('revoke all on function %s from public,anon,authenticated',proc.signature);
  execute format('grant execute on function %s to service_role',proc.signature);
 end loop;
end;
$functions$;

-- END NOTIFICATIONS V080
