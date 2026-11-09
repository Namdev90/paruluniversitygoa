-- Runner owns service-role BEGIN/COMMIT for setup/verify; cleanup uses the fixture owner.
-- Only an opaque fixture phase/prefix/principal is passed through local settings.
-- The runner refuses non-loopback/non-navrang_fixture targets before loading SQL.
do $fixture$
declare
 phase text:=current_setting('navrang_fixture.phase');
 prefix text:=current_setting('navrang_fixture.prefix');
 fixture_principal uuid:=current_setting('navrang_fixture.principal')::uuid;
 i integer; expected text[]; actual text[]; before_revision bigint; original_id uuid; replay_id uuid;
begin
 if prefix !~ '^synthetic-concurrency-[a-f0-9]{32}$' or current_database() !~ '^navrang_fixture[A-Za-z0-9_]*$' then
  raise exception 'Refusing an invalid disposable concurrency fixture';
 end if;
 if phase='setup' then
  if exists(select 1 from navrang_private.notification_config where center_enabled or delivery_enabled) then
   raise exception 'Concurrency fixture requires disabled initial communications';
  end if;
  insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,helpdesk_enabled,selected_station)
  values(fixture_principal,'Synthetic concurrency checker','code',true,true,true,false,'checker');
  update navrang_private.notification_config set center_enabled=true,delivery_enabled=false where singleton;
  for i in 1..5 loop
   perform navrang_private.append_notification_event(jsonb_build_object('key',prefix||':'||i,'kind','announcement',
    'actor','admin','title','Synthetic concurrency '||i,'body','Disposable database fixture only.',
    'destination','notifications','audience',jsonb_build_object('type','everyone')),array[fixture_principal::text]);
  end loop;
  if (select count(*) from navrang_private.notification_items item where item.principal=fixture_principal::text)<>5 then
   raise exception 'Concurrency fixture did not start with five items';
  end if;
 elsif phase='verify' then
  select array_agg(event.event_key order by item.revision desc,item.event_id desc) into actual
  from navrang_private.notification_items item join navrang_private.notification_events event on event.id=item.event_id
  where item.principal=fixture_principal::text;
  expected:=array[prefix||':7',prefix||':6',prefix||':5',prefix||':4',prefix||':3'];
  if actual is distinct from expected then raise exception 'Concurrent retention order/count incorrect: %',actual;end if;
  if (select count(distinct item.event_id) from navrang_private.notification_items item where item.principal=fixture_principal::text)<>5 or
     (select count(distinct item.revision) from navrang_private.notification_items item where item.principal=fixture_principal::text)<>5 then
   raise exception 'Concurrent appends duplicated an event or shared a recipient revision';
  end if;
  if (select count(*) from navrang_private.notification_events where event_key like prefix||':%')<>7 or
     (select count(*) from navrang_private.notification_sources where source_key like prefix||':%')<>7 then
   raise exception 'Concurrent append lost or duplicated a source event';
  end if;
  select revision into before_revision from navrang_private.notification_centers center where center.principal=fixture_principal::text;
  if before_revision is distinct from (select max(item.revision) from navrang_private.notification_items item where item.principal=fixture_principal::text) then
   raise exception 'Center revision does not identify the newest retained item';
  end if;
  select id into original_id from navrang_private.notification_events where event_key=prefix||':7';
  replay_id:=navrang_private.append_notification_event(jsonb_build_object('key',prefix||':7','kind','announcement',
   'actor','admin','title','Synthetic concurrency 7','body','Disposable database fixture only.',
   'destination','notifications','audience',jsonb_build_object('type','everyone')),array[fixture_principal::text]);
  if replay_id is distinct from original_id or before_revision is distinct from
     (select revision from navrang_private.notification_centers center where center.principal=fixture_principal::text) then
   raise exception 'Retried event changed its ID or recipient revision';
  end if;
 elsif phase='cleanup' then
  update navrang_private.notification_config set center_enabled=false,delivery_enabled=false where singleton;
  delete from navrang_private.notification_events where event_key like prefix||':%';
  delete from navrang_private.notification_centers center where center.principal=fixture_principal::text;
  delete from navrang_private.checkers where id=fixture_principal;
  delete from navrang_private.communication_capability_revisions revisions where revisions.principal=fixture_principal::text;
  if exists(select 1 from navrang_private.notification_sources where source_key like prefix||':%') or
     exists(select 1 from navrang_private.notification_items item where item.principal=fixture_principal::text) or
     exists(select 1 from navrang_private.checkers where id=fixture_principal) then
   raise exception 'Committed concurrency fixtures were not removed';
  end if;
 else raise exception 'Unknown concurrency fixture phase';
 end if;
end;
$fixture$;
