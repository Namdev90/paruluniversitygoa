-- No worker or provider runs. Every row and simulated receipt is ROLLBACK-only.
do $test$
declare
 admin_token text:=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
 staff_token text:=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
 staff uuid:=gen_random_uuid(); other_staff uuid:=gen_random_uuid(); binding uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); notice uuid;
 r jsonb; before_revision bigint;
begin
 update navrang_private.notification_config set center_enabled=true,delivery_enabled=true where singleton;
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station)
 values(staff,'Synthetic delivery volunteer','code',true,true,true,'checker'),(other_staff,'Synthetic unrelated volunteer','code',true,true,true,'checker');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(admin_token,'admin',null,clock_timestamp()+interval '1 hour'),(staff_token,'checker',staff,clock_timestamp()+interval '1 hour');
 insert into navrang_private.locator_event_admins values('O9KL3','admin','Namdev') on conflict(event_id,principal) do update set display_name='Namdev';
 insert into navrang_private.notification_devices(installation_id,binding_id,principal,session_hash,provider_type,provider_value,unlink_hash)
 values('fixture-locator-'||staff::text,binding,staff::text,staff_token,'legacyToken','fixture-only-never-delivered',repeat('f',64));
 perform public.navrang_locator('locator-consent',jsonb_build_object('eventId','O9KL3','requestId',gen_random_uuid(),'disclosureVersion',1,'location',false,'findMe',true),staff_token);
 perform public.navrang_locator('locator-duty',jsonb_build_object('eventId','O9KL3','requestId',gen_random_uuid(),'durationMinutes',30),staff_token);
 r:=public.navrang_locator('locator-request',jsonb_build_object('eventId','O9KL3','requestId',request_id,'volunteerId',staff),admin_token);
 select notification_event_id into notice from navrang_private.locator_requests where id=request_id;
 if notice is null or r->>'delivery' is distinct from 'queued' then raise exception 'Find-me did not queue a private notice';end if;
 if not exists(select 1 from navrang_private.notification_events where id=notice and kind='find-me' and destination='account' and title='Namdev is trying to find you' and payload->>'locatorRequestId'=request_id::text)
 or (select count(*) from navrang_private.notification_items where event_id=notice)<>1
 or not exists(select 1 from navrang_private.notification_items where event_id=notice and principal=staff::text)
 or exists(select 1 from navrang_private.notification_outbox where event_id=notice and principal<>staff::text) then raise exception 'Find-me delivery target was broadened';end if;
 if (select count(*) from navrang_private.notification_outbox where event_id=notice and binding_id=binding and status='queued')<>1 then raise exception 'Find-me did not use durable outbox';end if;
 if navrang_private.notification_event_allowed(notice,other_staff::text) then raise exception 'Another volunteer could read the request notice';end if;
 if exists(select 1 from navrang_private.notification_events where id=notice and (payload ? 'latitude' or payload ? 'longitude' or body like '%15.49%')) then raise exception 'Location leaked into notification';end if;
 r:=public.navrang_locator('locator-request',jsonb_build_object('eventId','O9KL3','requestId',request_id,'volunteerId',staff),admin_token);
 if (select count(*) from navrang_private.notification_outbox where event_id=notice)<>1 then raise exception 'Request replay duplicated transport';end if;
 update navrang_private.notification_outbox set status='accepted' where event_id=notice;
 r:=public.navrang_locator('locator-request',jsonb_build_object('eventId','O9KL3','requestId',request_id,'volunteerId',staff),admin_token);
 if r->>'delivery' is distinct from 'sent' or r->>'state' is distinct from 'sent' then raise exception 'Provider acceptance not distinct from device acknowledgement';end if;
 r:=public.navrang_locator('locator-respond',jsonb_build_object('eventId','O9KL3','requestId',request_id,'choice','acknowledged'),staff_token);
 if r->>'state' is distinct from 'device-acknowledged' then raise exception 'Device acknowledgement was lost';end if;
 r:=public.navrang_locator('locator-status','{"eventId":"O9KL3"}',admin_token);
 if r->'request'->>'state' is distinct from 'device-acknowledged' then raise exception 'Administrator cannot reconcile current target status';end if;
 if not exists(select 1 from navrang_private.notification_items i join navrang_private.notification_events e on e.id=i.event_id where i.principal='admin' and e.kind='find-me' and e.payload->>'locatorRequestId'=request_id::text)
 then raise exception 'Acknowledgement did not invalidate the assigned administrator';end if;
 select revision into before_revision from navrang_private.notification_centers where principal=staff::text;
 update navrang_private.notification_outbox set status='queued' where event_id=notice;
 perform public.navrang_locator('locator-stop',jsonb_build_object('eventId','O9KL3','requestId',gen_random_uuid()),staff_token);
 if exists(select 1 from navrang_private.notification_items where event_id=notice)
 or exists(select 1 from navrang_private.notification_outbox where event_id=notice and status in ('queued','leased'))
 or not exists(select 1 from navrang_private.notification_centers where principal=staff::text and revision>before_revision) then raise exception 'Stop retained an actionable notice or queued push';end if;
 raise notice 'PASS: selected private outbox, no coordinates, replay, sent/device acknowledgement, admin invalidation and Stop';
end;
$test$;
