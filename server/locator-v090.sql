-- Local preparation only; reviewed deployment and event assignment are separate.
-- Apply after session-renewal-v090.sql. All state is private and service-only.
create table if not exists navrang_private.locator_event_admins(
 event_id text not null references navrang_private.event(id),principal text not null check(principal='admin'),
 display_name text not null check(length(display_name) between 1 and 80),primary key(event_id,principal)
);
create table if not exists navrang_private.locator_consents(
 event_id text not null references navrang_private.event(id),checker_id uuid not null references navrang_private.checkers(id) on delete cascade,
 disclosure_version integer not null check(disclosure_version=1),location boolean not null default false,find_me boolean not null default false,
 version bigint not null default 1,changed_at timestamptz not null default clock_timestamp(),primary key(event_id,checker_id)
);
create table if not exists navrang_private.locator_duties(
 event_id text not null,checker_id uuid not null,consent_version bigint not null,
 session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),family_id uuid references navrang_private.session_families(id) on delete cascade,
 expires_at timestamptz not null,primary key(event_id,checker_id),
 foreign key(event_id,checker_id) references navrang_private.locator_consents(event_id,checker_id) on delete cascade
);
create table if not exists navrang_private.locator_requests(
 id uuid primary key,event_id text not null references navrang_private.event(id),principal text not null,
 checker_id uuid not null references navrang_private.checkers(id) on delete cascade,administrator text not null,consent_version bigint not null,
 owner_hash text not null,owner_family uuid references navrang_private.session_families(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 delivery text not null default 'queued' check(delivery in ('queued','sent')),
 acknowledged_at timestamptz,declined_at timestamptz,found_at timestamptz,stopped_at timestamptz,sound_at timestamptz,bright_at timestamptz,
 check(expires_at<=created_at+interval '2 minutes')
);
create index if not exists locator_request_target on navrang_private.locator_requests(event_id,checker_id,created_at);
create index if not exists locator_request_owner on navrang_private.locator_requests(event_id,principal,created_at);
alter table navrang_private.locator_requests add column if not exists notification_event_id uuid references navrang_private.notification_events(id) on delete set null;
create table if not exists navrang_private.locator_fixes(
 event_id text not null,checker_id uuid not null,sample_id uuid not null unique,
 latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),
 accuracy double precision not null check(accuracy between 0 and 5000),captured_at timestamptz not null,expires_at timestamptz not null,
 primary key(event_id,checker_id),foreign key(event_id,checker_id) references navrang_private.locator_duties(event_id,checker_id) on delete cascade,
 check(expires_at<=captured_at+interval '2 minutes')
);
-- Deduplication/audit never contains coordinates or raw session credentials.
create table if not exists navrang_private.locator_audit(
 event_id text not null,principal text not null,operation_id uuid not null,action text not null,
 at timestamptz not null default clock_timestamp(),primary key(event_id,principal,operation_id,action)
);
alter table navrang_private.locator_event_admins enable row level security;
alter table navrang_private.locator_consents enable row level security;
alter table navrang_private.locator_duties enable row level security;
alter table navrang_private.locator_requests enable row level security;
alter table navrang_private.locator_fixes enable row level security;
alter table navrang_private.locator_audit enable row level security;
revoke all on navrang_private.locator_event_admins,navrang_private.locator_consents,navrang_private.locator_duties,navrang_private.locator_requests,navrang_private.locator_fixes,navrang_private.locator_audit from public,anon,authenticated;
grant select,insert,update,delete on navrang_private.locator_event_admins,navrang_private.locator_consents,navrang_private.locator_duties,navrang_private.locator_requests,navrang_private.locator_fixes,navrang_private.locator_audit to service_role;

create or replace function navrang_private.locator_owner_alive(p_hash text,p_family uuid,p_checker uuid,p_role text)
returns boolean language sql security invoker set search_path='' as $alive$
 select case when p_family is null then exists(select 1 from navrang_private.sessions s where s.hash=p_hash and s.role=p_role and s.checker_id is not distinct from p_checker and s.expires_at>clock_timestamp())
 else exists(select 1 from navrang_private.session_families f where f.id=p_family and f.role=p_role and f.checker_id is not distinct from p_checker and f.revoked_at is null and f.idle_expires_at>clock_timestamp() and f.absolute_expires_at>clock_timestamp()) end;
$alive$;
create or replace function navrang_private.locator_duty_active(p_event text,p_checker uuid)
returns boolean language sql security invoker set search_path='' as $duty$
 select exists(select 1 from navrang_private.locator_duties d
 join navrang_private.locator_consents c using(event_id,checker_id) join navrang_private.checkers k on k.id=d.checker_id
 where d.event_id=p_event and d.checker_id=p_checker and d.expires_at>clock_timestamp() and d.consent_version=c.version
 and (c.location or c.find_me) and k.active and (k.method<>'google' or k.name_confirmed)
 and (k.scanner_enabled or k.helpdesk_enabled) and (k.access_expires_at is null or k.access_expires_at>clock_timestamp())
 and navrang_private.locator_owner_alive(d.session_hash,d.family_id,d.checker_id,'checker'));
$duty$;
create or replace function navrang_private.locator_notification_allowed(p_event uuid,p_principal text)
returns boolean language sql security invoker set search_path='' as $notice$
 select exists(select 1 from navrang_private.notification_events e join navrang_private.locator_requests r on r.id::text=e.payload->>'locatorRequestId'
 where e.id=p_event and e.kind='find-me' and e.at>clock_timestamp()-interval '24 hours'
 and exists(select 1 from navrang_private.locator_event_admins a where a.event_id=r.event_id and a.principal=r.principal)
 and ((p_principal=r.principal and e.payload->'locatorTerminal'='true'::jsonb) or
  (p_principal in (r.principal,r.checker_id::text) and r.expires_at>clock_timestamp() and r.stopped_at is null and r.declined_at is null and r.found_at is null
   and navrang_private.locator_duty_active(r.event_id,r.checker_id) and navrang_private.locator_owner_alive(r.owner_hash,r.owner_family,null,'admin')
   and exists(select 1 from navrang_private.locator_consents c where c.event_id=r.event_id and c.checker_id=r.checker_id and c.find_me and c.version=r.consent_version))));
$notice$;
create or replace function navrang_private.end_locator_notices(p_request uuid)
returns void language plpgsql security invoker set search_path='' as $end$
declare notice record; recipient text;
begin
 for notice in select id from navrang_private.notification_events where kind='find-me' and payload->>'locatorRequestId'=p_request::text and payload->'locatorTerminal' is distinct from 'true'::jsonb and ended_at is null loop
  update navrang_private.notification_events set ended_at=clock_timestamp() where id=notice.id;
  for recipient in select principal from navrang_private.notification_items where event_id=notice.id order by principal loop
   perform pg_advisory_xact_lock(hashtextextended(recipient,82));
   update navrang_private.notification_centers set revision=nextval('navrang_private.notification_revision_seq') where principal=recipient;
  end loop;
  delete from navrang_private.notification_items where event_id=notice.id;
  update navrang_private.notification_outbox set status='cancelled',updated_at=clock_timestamp() where event_id=notice.id and status in ('queued','leased');
 end loop;
end;
$end$;
create or replace function navrang_private.locator_owner_notice(r navrang_private.locator_requests,p_update text,p_suffix text default '')
returns uuid language plpgsql security invoker set search_path='' as $notice$
begin
 if p_update not in ('acknowledged','declined','stopped','found','location') then return null;end if;
 if not exists(select 1 from navrang_private.locator_event_admins where event_id=r.event_id and principal=r.principal) then return null;end if;
 return navrang_private.append_notification_event(jsonb_build_object('key','locator-response:'||r.id::text||':'||p_update||':'||p_suffix,'kind','find-me','actor',r.checker_id::text,
  'title','Find-me response','body',case p_update when 'acknowledged' then 'Your selected volunteer acknowledged the request. Finding is not yet confirmed.' when 'declined' then 'Your selected volunteer declined the optional request.' when 'stopped' then 'Sharing stopped. No current location should be inferred.' when 'found' then 'Finding was confirmed by the assigned administrator.' else 'Your selected volunteer shared one location sample. Open Navrang to view its time and accuracy.' end,
  'destination','account','audience',jsonb_build_object('type','roles','roles',jsonb_build_array('administrator')),'locatorRequestId',r.id,'locatorTerminal',p_update in ('declined','stopped','found')),array[r.principal]);
exception when others then return null; -- Optional delivery cannot prevent security cleanup.
end;
$notice$;
create or replace function navrang_private.stop_locator_duty(p_event text,p_checker uuid)
returns void language plpgsql security invoker set search_path='' as $stop$
declare request_row navrang_private.locator_requests%rowtype;
begin
 delete from navrang_private.locator_duties where event_id=p_event and checker_id=p_checker;
 for request_row in update navrang_private.locator_requests set stopped_at=clock_timestamp() where event_id=p_event and checker_id=p_checker and stopped_at is null and found_at is null and declined_at is null returning * loop
  begin perform navrang_private.end_locator_notices(request_row.id);exception when others then null;end;
  perform navrang_private.locator_owner_notice(request_row,'stopped');
 end loop;
end;
$stop$;
create or replace function navrang_private.prune_locator()
returns void language plpgsql security invoker set search_path='' as $prune$
declare d record;
begin
 delete from navrang_private.locator_fixes where expires_at<=clock_timestamp();
 for d in select event_id,checker_id from navrang_private.locator_duties x where not navrang_private.locator_duty_active(x.event_id,x.checker_id)
 loop perform navrang_private.stop_locator_duty(d.event_id,d.checker_id);end loop;
 for d in select id from navrang_private.locator_requests where expires_at<=clock_timestamp() or stopped_at is not null or declined_at is not null or found_at is not null
 loop begin perform navrang_private.end_locator_notices(d.id);exception when others then null;end;end loop;
 delete from navrang_private.notification_events where kind='find-me' and payload ? 'locatorRequestId' and at<clock_timestamp()-interval '24 hours';
 delete from navrang_private.locator_requests where expires_at<clock_timestamp()-interval '24 hours';
 delete from navrang_private.locator_audit where at<clock_timestamp()-interval '24 hours';
end;
$prune$;
create or replace function navrang_private.locator_status(p_event text,p_checker uuid)
returns jsonb language sql security invoker set search_path='' as $status$
 select jsonb_build_object('eventId',p_event,'serverTime',clock_timestamp(),'disclosureVersion',coalesce(c.disclosure_version,0),'location',coalesce(c.location,false),'findMe',coalesce(c.find_me,false),'version',coalesce(c.version,0),
 'onDuty',navrang_private.locator_duty_active(p_event,p_checker),'expiresAt',case when navrang_private.locator_duty_active(p_event,p_checker) then d.expires_at end)
 from (select 1) seed left join navrang_private.locator_consents c on c.event_id=p_event and c.checker_id=p_checker
 left join navrang_private.locator_duties d on d.event_id=p_event and d.checker_id=p_checker;
$status$;
create or replace function navrang_private.locator_request_json(r navrang_private.locator_requests)
returns jsonb language sql security invoker set search_path='' as $request$
 select jsonb_build_object('requestId',r.id,'serverTime',clock_timestamp(),'volunteerId',r.checker_id,'administrator',r.administrator,'createdAt',r.created_at,'expiresAt',r.expires_at,'delivery',case when transport.sent then 'sent' else 'queued' end,
 'state',case when r.found_at is not null then 'found' when r.declined_at is not null then 'declined' when r.stopped_at is not null then 'stopped' when r.expires_at<=clock_timestamp() then 'expired' when r.acknowledged_at is not null then 'device-acknowledged' when transport.sent then 'sent' else 'queued' end)
 from (select r.delivery='sent' or exists(select 1 from navrang_private.notification_outbox where event_id=r.notification_event_id and status='accepted') as sent) transport;
$request$;

create or replace function public.navrang_locator(p_action text,p jsonb default '{}'::jsonb,p_token text default '')
returns jsonb language plpgsql security invoker set search_path='' as $locator$
declare
 actor jsonb; principal_key text; event_key text:='O9KL3'; staff_id uuid; target uuid; operation uuid;
 allowed text[]; required text[]; c navrang_private.locator_consents%rowtype; d navrang_private.locator_duties%rowtype;
 request_row navrang_private.locator_requests%rowtype; session_row navrang_private.sessions%rowtype;
 admin_name text; checked_at timestamptz; captured timestamptz; expiry timestamptz; duration integer;
 lat double precision; lon double precision; accuracy double precision; duplicate boolean; perform_action boolean:=false; response jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>2048 or p->>'eventId' is distinct from event_key then return jsonb_build_object('error','Invalid locator request.','status',400);end if;
 allowed:=case p_action
 when 'locator-status' then array['eventId'] when 'locator-roster' then array['eventId'] when 'locator-inbox' then array['eventId']
 when 'locator-view' then array['eventId','volunteerId'] when 'locator-consent' then array['eventId','requestId','disclosureVersion','location','findMe']
 when 'locator-duty' then array['eventId','requestId','durationMinutes'] when 'locator-stop' then array['eventId','requestId']
 when 'locator-request' then array['eventId','requestId','volunteerId'] when 'locator-respond' then array['eventId','requestId','choice']
 when 'locator-found' then array['eventId','requestId'] when 'locator-fix' then array['eventId','sampleId','requestId','latitude','longitude','accuracy','capturedAt'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p) as supplied(key) where key<>all(allowed)) then return jsonb_build_object('error','Invalid locator fields.','status',400);end if;
 required:=case when p_action='locator-fix' then array_remove(allowed,'requestId') else allowed end;
 if not p ?& required then return jsonb_build_object('error','Incomplete locator request.','status',400);end if;
 if p ? 'requestId' and (p->>'requestId' is null or p->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then return jsonb_build_object('error','Invalid locator operation.','status',400);end if;
 if p ? 'requestId' then operation:=(p->>'requestId')::uuid;end if;
 if p ? 'volunteerId' then target:=(p->>'volunteerId')::uuid;end if;
 actor:=navrang_private.resolve_actor(p_token);if actor ? 'error' then return actor;end if;
 if actor->>'active'<>'true' then return jsonb_build_object('error','Active event access is required.','status',403);end if;
 principal_key:=actor->>'principal';
 if actor->>'admin'='true' then
  select display_name into admin_name from navrang_private.locator_event_admins where event_id=event_key and principal=principal_key;
  if p_action='locator-status' then return jsonb_build_object('eventId',event_key,'administrator',true,'assigned',admin_name is not null,'request',case when admin_name is not null then (select navrang_private.locator_request_json(existing) from navrang_private.locator_requests existing where existing.event_id=event_key and existing.principal=principal_key order by existing.created_at desc,existing.id desc limit 1) end);end if;
  if admin_name is null or p_action not in ('locator-roster','locator-view','locator-request','locator-found') then return jsonb_build_object('error','Assigned event administrator access is required.','status',403);end if;
 else
  if p_action in ('locator-roster','locator-view','locator-request','locator-found') or not(coalesce((actor->>'scanner')::boolean,false) or coalesce((actor->>'helpdesk')::boolean,false)) then return jsonb_build_object('error','Assigned volunteer access is required.','status',403);end if;
  staff_id:=principal_key::uuid;
 end if;
 -- Serialize each principal's mutations. Re-read times/auth after lock waits.
 perform pg_advisory_xact_lock(hashtextextended('locator:'||event_key||':'||principal_key,0));
 actor:=navrang_private.resolve_actor(p_token);if actor ? 'error' then return actor;end if;
 if actor->>'active'<>'true' then return jsonb_build_object('error','Event access changed.','status',403);end if;
 if staff_id is not null and not(coalesce((actor->>'scanner')::boolean,false) or coalesce((actor->>'helpdesk')::boolean,false)) then return jsonb_build_object('error','Volunteer access changed.','status',403);end if;
 if staff_id is null then
  select display_name into admin_name from navrang_private.locator_event_admins where event_id=event_key and principal=principal_key;
  if not found then return jsonb_build_object('error','Event assignment changed.','status',403);end if;
 end if;
 select * into session_row from navrang_private.sessions where hash=p_token and expires_at>clock_timestamp() for share;
 if not found then return jsonb_build_object('error','Sign in again.','status',401);end if;
 checked_at:=clock_timestamp();perform navrang_private.prune_locator();
 if p_action='locator-status' then return navrang_private.locator_status(event_key,staff_id);end if;
 if p_action='locator-roster' then
  select coalesce(jsonb_agg(jsonb_build_object('volunteerId',k.id,'name',k.name,'location',consent.location,'findMe',consent.find_me,'expiresAt',duty.expires_at) order by k.name,k.id),'[]'::jsonb) into response
  from navrang_private.locator_duties duty join navrang_private.locator_consents consent using(event_id,checker_id) join navrang_private.checkers k on k.id=duty.checker_id
  where duty.event_id=event_key and navrang_private.locator_duty_active(event_key,duty.checker_id);
  return jsonb_build_object('items',response);
 end if;
 if p_action='locator-view' then
  select * into c from navrang_private.locator_consents where event_id=event_key and checker_id=target;
  if not found or not c.location or not navrang_private.locator_duty_active(event_key,target) then return jsonb_build_object('error','No current shared location.','status',404);end if;
  select jsonb_build_object('latitude',f.latitude,'longitude',f.longitude,'accuracy',f.accuracy,'capturedAt',f.captured_at,'expiresAt',f.expires_at) into response from navrang_private.locator_fixes f where f.event_id=event_key and f.checker_id=target and f.expires_at>clock_timestamp();
  return jsonb_build_object('volunteerId',target,'fix',response);
 end if;
 if p_action='locator-inbox' then
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) into response from (
   select navrang_private.locator_request_json(r) item,r.created_at from navrang_private.locator_requests r
   join navrang_private.locator_consents consent on consent.event_id=r.event_id and consent.checker_id=r.checker_id
   where r.event_id=event_key and r.checker_id=staff_id and consent.find_me and consent.version=r.consent_version and r.expires_at>checked_at
   and r.stopped_at is null and r.declined_at is null and r.found_at is null and navrang_private.locator_duty_active(event_key,staff_id)
   and exists(select 1 from navrang_private.locator_event_admins a where a.event_id=r.event_id and a.principal=r.principal)
   and navrang_private.locator_owner_alive(r.owner_hash,r.owner_family,null,'admin') order by r.created_at desc limit 5
  ) x;
  return jsonb_build_object('items',response);
 end if;
 if p_action in ('locator-consent','locator-duty','locator-stop','locator-fix') then
  if p_action='locator-fix' then operation:=(p->>'sampleId')::uuid;end if;
  select exists(select 1 from navrang_private.locator_audit where event_id=event_key and principal=principal_key and operation_id=operation and action=p_action) into duplicate;
  if duplicate then
   if p_action='locator-fix' then return jsonb_build_object('saved',false,'duplicate',true);end if;
   return navrang_private.locator_status(event_key,staff_id)||jsonb_build_object('duplicate',true);
  end if;
 end if;
 if p_action='locator-consent' then
  if p->'disclosureVersion'<>'1'::jsonb or jsonb_typeof(p->'location')<>'boolean' or jsonb_typeof(p->'findMe')<>'boolean' then return jsonb_build_object('error','Read the current disclosure and choose separately.','status',400);end if;
  perform navrang_private.stop_locator_duty(event_key,staff_id);
  insert into navrang_private.locator_consents as consent(event_id,checker_id,disclosure_version,location,find_me) values(event_key,staff_id,1,(p->>'location')::boolean,(p->>'findMe')::boolean)
  on conflict(event_id,checker_id) do update set location=excluded.location,find_me=excluded.find_me,version=consent.version+1,changed_at=checked_at;
 elsif p_action='locator-stop' then perform navrang_private.stop_locator_duty(event_key,staff_id);
 elsif p_action='locator-duty' then
  if jsonb_typeof(p->'durationMinutes')<>'number' or p->>'durationMinutes' !~ '^[0-9]+$' then return jsonb_build_object('error','Choose a duty duration.','status',400);end if;
  duration:=(p->>'durationMinutes')::integer;if duration<1 or duration>60 then return jsonb_build_object('error','Duty may last at most one hour.','status',400);end if;
  select * into c from navrang_private.locator_consents where event_id=event_key and checker_id=staff_id for update;
  if not found or not(c.location or c.find_me) then return jsonb_build_object('error','Choose optional duty consent first.','status',409);end if;
  perform navrang_private.stop_locator_duty(event_key,staff_id);
  select least(checked_at+duration*interval '1 minute',coalesce(k.access_expires_at,'infinity'::timestamptz)) into expiry from navrang_private.checkers k where id=staff_id;
  insert into navrang_private.locator_duties values(event_key,staff_id,c.version,p_token,session_row.family_id,expiry);
 elsif p_action='locator-request' then
  select * into request_row from navrang_private.locator_requests where id=operation;
  if found then
   if request_row.event_id<>event_key or request_row.principal<>principal_key or request_row.checker_id<>target then return jsonb_build_object('error','Request ID already used.','status',409);end if;
   return navrang_private.locator_request_json(request_row)||jsonb_build_object('duplicate',true);
  end if;
  select * into c from navrang_private.locator_consents where event_id=event_key and checker_id=target for update;
  if not found or not c.find_me or not navrang_private.locator_duty_active(event_key,target) then return jsonb_build_object('error','This volunteer has not enabled find-me while on duty.','status',409);end if;
  checked_at:=clock_timestamp();
  if exists(select 1 from navrang_private.locator_requests where event_id=event_key and checker_id=target and created_at>checked_at-interval '1 minute') or
     (select count(*) from navrang_private.locator_requests where event_id=event_key and principal=principal_key and created_at>checked_at-interval '10 minutes')>=10 then return jsonb_build_object('error','Find-me cooldown is active.','status',429);end if;
  update navrang_private.locator_requests set stopped_at=checked_at where event_id=event_key and principal=principal_key and expires_at>checked_at and stopped_at is null and found_at is null and declined_at is null;
  select least(checked_at+interval '2 minutes',expires_at) into expiry from navrang_private.locator_duties where event_id=event_key and checker_id=target;
  insert into navrang_private.locator_requests(id,event_id,principal,checker_id,administrator,consent_version,owner_hash,owner_family,created_at,expires_at) values(operation,event_key,principal_key,target,admin_name,c.version,p_token,session_row.family_id,checked_at,expiry) returning * into request_row;
  update navrang_private.locator_requests set notification_event_id=navrang_private.append_notification_event(jsonb_build_object('key','locator-request:'||operation::text,'kind','find-me','actor',principal_key,'title',admin_name||' is trying to find you','body','This optional request expires in two minutes. Open Navrang to acknowledge, share once, identify yourself, decline or Stop.','destination','account','audience',jsonb_build_object('type','staff','staffIds',jsonb_build_array(target::text)),'locatorRequestId',operation),array[target::text]) where id=operation returning * into request_row;
  insert into navrang_private.locator_audit(event_id,principal,operation_id,action) values(event_key,principal_key,operation,p_action);
  return navrang_private.locator_request_json(request_row);
 elsif p_action in ('locator-respond','locator-found') then
  select * into request_row from navrang_private.locator_requests where id=operation and event_id=event_key and ((staff_id is not null and checker_id=staff_id) or (staff_id is null and principal=principal_key)) for update;
  if not found then return jsonb_build_object('error','Request is unavailable.','status',404);end if;
  if request_row.found_at is not null and p_action='locator-found' then return navrang_private.locator_request_json(request_row)||jsonb_build_object('duplicate',true);end if;
  if request_row.expires_at<=clock_timestamp() or request_row.stopped_at is not null or request_row.declined_at is not null or request_row.found_at is not null or not navrang_private.locator_duty_active(event_key,request_row.checker_id)
   or not exists(select 1 from navrang_private.locator_event_admins where event_id=event_key and principal=request_row.principal) or not navrang_private.locator_owner_alive(request_row.owner_hash,request_row.owner_family,null,'admin') then return jsonb_build_object('error','Request expired or stopped.','status',409);end if;
  if p_action='locator-found' then
   update navrang_private.locator_requests set found_at=clock_timestamp() where id=operation;
   begin perform navrang_private.end_locator_notices(operation);exception when others then null;end;
   perform navrang_private.locator_owner_notice(request_row,'found');
  else
   if p->>'choice' not in ('acknowledged','declined','sound','bright') then return jsonb_build_object('error','Choose a voluntary response.','status',400);end if;
   perform_action:=case p->>'choice' when 'sound' then request_row.sound_at is null when 'bright' then request_row.bright_at is null else false end;
   update navrang_private.locator_requests set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),
    declined_at=case when p->>'choice'='declined' then clock_timestamp() else declined_at end,
    sound_at=case when p->>'choice'='sound' then coalesce(sound_at,clock_timestamp()) else sound_at end,
    bright_at=case when p->>'choice'='bright' then coalesce(bright_at,clock_timestamp()) else bright_at end where id=operation;
   if p->>'choice'='declined' then
    begin perform navrang_private.end_locator_notices(operation);exception when others then null;end;
    perform navrang_private.locator_owner_notice(request_row,'declined');
   elsif request_row.acknowledged_at is null then perform navrang_private.locator_owner_notice(request_row,'acknowledged');end if;
  end if;
  insert into navrang_private.locator_audit(event_id,principal,operation_id,action) values(event_key,principal_key,operation,case when p_action='locator-respond' then p_action||':'||(p->>'choice') else p_action end) on conflict do nothing;
  select * into request_row from navrang_private.locator_requests where id=operation;
  return navrang_private.locator_request_json(request_row)||jsonb_build_object('performAction',perform_action);
 elsif p_action='locator-fix' then
  if jsonb_typeof(p->'latitude')<>'number' or jsonb_typeof(p->'longitude')<>'number' or jsonb_typeof(p->'accuracy')<>'number' or jsonb_typeof(p->'capturedAt')<>'string' then return jsonb_build_object('error','Invalid location sample.','status',400);end if;
  lat:=(p->>'latitude')::double precision;lon:=(p->>'longitude')::double precision;accuracy:=(p->>'accuracy')::double precision;captured:=(p->>'capturedAt')::timestamptz;
  if not(lat between -90 and 90 and lon between -180 and 180 and accuracy between 0 and 5000) or captured<clock_timestamp()-interval '30 seconds' or captured>clock_timestamp()+interval '5 seconds' then return jsonb_build_object('error','Location must be a fresh bounded sample.','status',400);end if;
  select * into c from navrang_private.locator_consents where event_id=event_key and checker_id=staff_id for update;
  if not found or not c.location or not navrang_private.locator_duty_active(event_key,staff_id) then return jsonb_build_object('error','Location sharing stopped or not consented.','status',409);end if;
  select * into d from navrang_private.locator_duties where event_id=event_key and checker_id=staff_id;
  expiry:=least(captured+interval '2 minutes',d.expires_at);
  if p ? 'requestId' then
   select * into request_row from navrang_private.locator_requests where id=(p->>'requestId')::uuid and event_id=event_key and checker_id=staff_id for share;
   if not found or request_row.expires_at<=clock_timestamp() or request_row.stopped_at is not null or request_row.declined_at is not null or request_row.found_at is not null or request_row.consent_version<>c.version
    or not exists(select 1 from navrang_private.locator_event_admins where event_id=event_key and principal=request_row.principal)
    or not navrang_private.locator_owner_alive(request_row.owner_hash,request_row.owner_family,null,'admin') then return jsonb_build_object('error','Find-me request expired or stopped.','status',409);end if;
   expiry:=least(expiry,request_row.expires_at);
  end if;
  if exists(select 1 from navrang_private.locator_fixes where event_id=event_key and checker_id=staff_id and captured_at>=captured) then return jsonb_build_object('error','A newer sample is already present.','status',409);end if;
  insert into navrang_private.locator_fixes values(event_key,staff_id,operation,lat,lon,accuracy,captured,expiry)
  on conflict(event_id,checker_id) do update set sample_id=excluded.sample_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,captured_at=excluded.captured_at,expires_at=excluded.expires_at;
  if p ? 'requestId' then perform navrang_private.locator_owner_notice(request_row,'location',operation::text);end if;
 else return jsonb_build_object('error','Unknown locator action.','status',400);
 end if;
 insert into navrang_private.locator_audit(event_id,principal,operation_id,action) values(event_key,principal_key,operation,p_action);
 if p_action='locator-fix' then return jsonb_build_object('saved',true,'expiresAt',expiry);end if;
 return navrang_private.locator_status(event_key,staff_id);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or not_null_violation or check_violation then
 return jsonb_build_object('error','Invalid locator request.','status',400);
end;
$locator$;

create or replace function navrang_private.locator_checker_changed()
returns trigger language plpgsql security invoker set search_path='' as $changed$
declare d record;
begin
 if not new.active or not(new.scanner_enabled or new.helpdesk_enabled) or (new.method='google' and not new.name_confirmed) or (new.access_expires_at is not null and new.access_expires_at<=clock_timestamp()) then
  for d in select event_id from navrang_private.locator_duties where checker_id=new.id loop perform navrang_private.stop_locator_duty(d.event_id,new.id);end loop;
 end if;return new;
end;
$changed$;
drop trigger if exists navrang_locator_checker_changed on navrang_private.checkers;
create trigger navrang_locator_checker_changed after update on navrang_private.checkers for each row execute function navrang_private.locator_checker_changed();

create or replace function navrang_private.locator_session_retired()
returns trigger language plpgsql security invoker set search_path='' as $retired$
declare duty record;
begin
 -- A consumed renewable access token is deleted during rotation; the family
 -- remains authoritative. Only legacy logout/expiry is tied to this hash.
 if old.family_id is null then
  for duty in select event_id,checker_id from navrang_private.locator_duties where session_hash=old.hash and family_id is null
  loop perform navrang_private.stop_locator_duty(duty.event_id,duty.checker_id);end loop;
  update navrang_private.locator_requests set stopped_at=coalesce(stopped_at,clock_timestamp()) where owner_hash=old.hash and owner_family is null and found_at is null and declined_at is null;
 end if;return old;
end;
$retired$;
drop trigger if exists navrang_locator_session_retired on navrang_private.sessions;
create trigger navrang_locator_session_retired after delete on navrang_private.sessions for each row execute function navrang_private.locator_session_retired();
create or replace function navrang_private.locator_family_retired()
returns trigger language plpgsql security invoker set search_path='' as $retired$
declare duty record;
begin
 if new.revoked_at is not null then
  for duty in select event_id,checker_id from navrang_private.locator_duties where family_id=new.id
  loop perform navrang_private.stop_locator_duty(duty.event_id,duty.checker_id);end loop;
  update navrang_private.locator_requests set stopped_at=coalesce(stopped_at,clock_timestamp()) where owner_family=new.id and found_at is null and declined_at is null;
 end if;return new;
end;
$retired$;
drop trigger if exists navrang_locator_family_retired on navrang_private.session_families;
create trigger navrang_locator_family_retired after update of revoked_at on navrang_private.session_families for each row execute function navrang_private.locator_family_retired();

revoke all on function navrang_private.locator_owner_alive(text,uuid,uuid,text),navrang_private.locator_duty_active(text,uuid),navrang_private.stop_locator_duty(text,uuid),navrang_private.prune_locator(),navrang_private.locator_status(text,uuid),navrang_private.locator_request_json(navrang_private.locator_requests),navrang_private.locator_checker_changed(),public.navrang_locator(text,jsonb,text) from public,anon,authenticated;
grant execute on function navrang_private.locator_owner_alive(text,uuid,uuid,text),navrang_private.locator_duty_active(text,uuid),navrang_private.stop_locator_duty(text,uuid),navrang_private.prune_locator(),navrang_private.locator_status(text,uuid),navrang_private.locator_request_json(navrang_private.locator_requests),navrang_private.locator_checker_changed(),public.navrang_locator(text,jsonb,text) to service_role;
revoke all on function navrang_private.locator_session_retired(),navrang_private.locator_family_retired() from public,anon,authenticated;
grant execute on function navrang_private.locator_session_retired(),navrang_private.locator_family_retired() to service_role;
revoke all on function navrang_private.locator_notification_allowed(uuid,text),navrang_private.end_locator_notices(uuid),navrang_private.locator_owner_notice(navrang_private.locator_requests,text,text) from public,anon,authenticated;
grant execute on function navrang_private.locator_notification_allowed(uuid,text),navrang_private.end_locator_notices(uuid),navrang_private.locator_owner_notice(navrang_private.locator_requests,text,text) to service_role;

-- No event assignment is seeded. No provider call, publication or production
-- change occurs here. The maintenance worker must invoke prune_locator on its
-- existing bounded cycle before live retention can be accepted.
