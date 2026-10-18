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
