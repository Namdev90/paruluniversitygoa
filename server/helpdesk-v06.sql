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
  select jsonb_build_object('id',id,'name',name,'active',active,'method',method) into result from navrang_private.checkers where code_hash=p->>'hash';
  return coalesce(result,'{}'::jsonb);
 elsif p_action='google-register' then
  if coalesce(trim(p->>'email'),'')='' then return jsonb_build_object('error','Verified Google email required.','status',401);end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p->>'email')),0));
  select * into c from navrang_private.checkers where method='google' and (google_id=(p->>'id')::uuid or lower(email)=lower(trim(p->>'email'))) for update;
  if found then
   update navrang_private.checkers set email=lower(trim(p->>'email')) where id=c.id returning * into c;
  else
   insert into navrang_private.checkers(google_id,name,email,method,active) values((p->>'id')::uuid,left(p->>'name',128),lower(trim(p->>'email')),'google',true) returning * into c;
  end if;
  return jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method);
 elsif p_action='session-create' then
  if p->>'role'='checker' then
   select * into c from navrang_private.checkers where id=(p->>'checkerId')::uuid;
   if not found then return jsonb_build_object('error','Checker not found.','status',403);end if;
  end if;
  insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(p->>'hash',p->>'role',c.id,now()+interval '12 hours');
  return jsonb_build_object('role',p->>'role','name',case when p->>'role'='admin' then 'namdev' else c.name end,'checkerId',c.id,'username',c.name,'accountKey',c.username,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method,'active',case when p->>'role'='admin' then true else c.active end,'expiresAt',now()+interval '12 hours');
 end if;
 select * into s from navrang_private.sessions where hash=p_token and expires_at>now();
 if not found then return jsonb_build_object('error','Sign in again. Your session expired.','status',401);end if;
 if s.role='checker' then select * into c from navrang_private.checkers where id=s.checker_id;end if;
 actor_key=coalesce(c.id::text,'admin'); actor_name=case when s.role='admin' then 'namdev' else c.name end;
 if p_action='checker-profile' then
  if s.role<>'checker' then return jsonb_build_object('error','Checker account required.','status',403);end if;
  if length(trim(p->>'name')) not between 1 and 40 or trim(p->>'name') ~ '[@0-9]' then return jsonb_build_object('error','Enter a real name, up to 40 letters.','status',400);end if;
  update navrang_private.checkers set name=trim(p->>'name'),name_confirmed=true where id=c.id returning * into c;
  return jsonb_build_object('saved',true,'name',c.name);
 end if;
 if p_action='logout' then delete from navrang_private.sessions where hash=p_token;return jsonb_build_object('signedOut',true);end if;
 if p_action='me' then return jsonb_build_object('role',s.role,'name',actor_name,'checkerId',c.id,'username',c.name,'accountKey',c.username,'nameConfirmed',c.name_confirmed,'method',c.method,'helpdesk',s.role='admin' or coalesce(c.helpdesk_enabled,false),'active',s.role='admin' or coalesce(c.active,false),'expiresAt',s.expires_at);end if;
 if s.role='checker' and not coalesce(c.active,false) then return jsonb_build_object('error','Your checker account needs admin approval or has been suspended.','status',403);end if;
 if p_action='checkin' and c.method='google' and not c.name_confirmed then return jsonb_build_object('error','Save your real checker name before scanning.','status',403);end if;
 if p_action in ('import','upsert','staff-create','staff-update','admin-password','helpdesk-review','helpdesk-edit','helpdesk-export') and s.role<>'admin' then return jsonb_build_object('error','Administrator access required.','status',403);end if;

 if p_action like 'helpdesk-%' then
  if s.role<>'admin' and not coalesce(c.helpdesk_enabled,false) then return jsonb_build_object('error','Ask Namdev to enable Help Desk access for your account in Admin → Checkers.','status',403);end if;
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
  insert into navrang_private.checkers(name,method,code_hash,active,name_confirmed) values(left(trim(p->>'name'),128),'code',p->>'hash',true,true) returning * into c;
  return jsonb_build_object('checker',jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method));
 elsif p_action='staff-update' then
  update navrang_private.checkers set active=(p->>'active')::boolean,helpdesk_enabled=coalesce((p->>'helpdesk')::boolean,helpdesk_enabled) where id=(p->>'id')::uuid returning * into c;
  if not found then return jsonb_build_object('error','Checker not found.','status',404);end if;
  return jsonb_build_object('checker',jsonb_build_object('id',c.id,'username',c.name,'accountKey',c.username,'name',c.name,'active',c.active,'helpdesk',c.helpdesk_enabled,'nameConfirmed',c.name_confirmed,'method',c.method));
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
  select * into e from navrang_private.event where id='O9KL3';
  if coalesce((p->>'dataRevision')::bigint,-1)<>e.data_revision then
   select coalesce(jsonb_agg(to_jsonb(ts)-'active'-'updated_at' order by ts.id),'[]') into records from navrang_private.tickets ts where ts.active;
  end if;
  select coalesce(jsonb_agg(z.receipt->'entry' order by z.seq),'[]'),coalesce(max(z.seq),coalesce((p->>'afterSeq')::bigint,0)) into entries,cursor_seq
   from (select ad.seq,ad.receipt from navrang_private.admissions ad where not ad.test_fixture and ad.seq>coalesce((p->>'afterSeq')::bigint,0) order by ad.seq limit 500) z;
  select coalesce(max(seq),0) into last_seq from navrang_private.admissions where not test_fixture;
  select jsonb_build_object('total',count(*),'eligible',count(*) filter(where ti.eligible),'blocked',count(*) filter(where not ti.eligible),'remaining',count(*) filter(where ti.eligible and not exists(select 1 from navrang_private.admissions ad where not ad.test_fixture and ad.ticket_id=ti.id))) into stats from navrang_private.tickets ti where ti.active;
  stats=stats||jsonb_build_object('admitted',(select count(*) from navrang_private.admissions where not test_fixture),'lastMinute',(select count(*) from navrang_private.admissions where not test_fixture and at>now()-interval '1 minute'),'lastFiveMinutes',(select count(*) from navrang_private.admissions where not test_fixture and at>now()-interval '5 minutes'),'duplicateAttempts',(select count(*) from navrang_private.attempts where not test_fixture and response->>'code'='duplicate'),'blockedAttempts',(select count(*) from navrang_private.attempts where not test_fixture and response->>'code' in ('blocked','not_found')));
  if s.role='admin' then
   select coalesce(jsonb_agg(jsonb_build_object('id',ck.id,'username',ck.name,'accountKey',ck.username,'name',ck.name,'email',ck.email,'method',ck.method,'active',ck.active,'helpdesk',ck.helpdesk_enabled,'entries',(select count(*) from navrang_private.admissions ad where not ad.test_fixture and ad.checker_id=ck.id)) order by ck.created_at),'[]') into staff from navrang_private.checkers ck;
  end if;
  return jsonb_build_object('dataRevision',e.data_revision,'source',e.source,'updatedAt',e.updated_at,'records',records,'entries',entries,'cursor',cursor_seq,'hasMore',cursor_seq<last_seq,'stats',stats,'checkers',staff);
 end if;
 return jsonb_build_object('error','Unknown operation.','status',400);
end;
$$;
revoke all on function public.navrang_gate(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_gate(text,jsonb,text) to service_role;
