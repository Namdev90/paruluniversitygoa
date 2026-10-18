-- Isolated, transaction-only database fixtures. Never run against production.
do $test$
declare
 admin_token text:=repeat('a',64); checker_token text:=repeat('b',64); faculty_token text:=repeat('c',64);
 checker_id uuid:=gen_random_uuid(); faculty_id uuid:=gen_random_uuid(); event_id uuid; first_id uuid;
 request_id uuid:=gen_random_uuid(); binding uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid(); admin_binding uuid:=gen_random_uuid();
 registration jsonb; second_registration jsonb; response jsonb; feed jsonb; preview jsonb; sent jsonb; jobs jsonb; job jsonb;
 payload jsonb; announcement jsonb:='{"type":"announcement","title":"Gate update","body":"Use the north gate.","urgency":"normal"}';
 everyone jsonb:='{"type":"everyone"}'; i integer; before_count bigint; after_count bigint; audit_id uuid:=gen_random_uuid();
begin
 if to_regprocedure('public.navrang_communications(text,jsonb,text)') is null then
  raise exception 'Missing transactional notification implementation';
 end if;
 update navrang_private.notification_config set center_enabled=true,delivery_enabled=true where singleton;
 insert into navrang_private.sessions(hash,role,expires_at) values(admin_token,'admin',clock_timestamp()+interval '1 hour');
 response:=public.navrang_communications('notifications-feed','{}',admin_token);if response ? 'error' or jsonb_typeof(response->'items') is distinct from 'array' then raise exception 'Public communications RPC did not delegate authenticated notifications';end if;
 insert into navrang_private.checkers(id,name,method,google_id,email,active,name_confirmed,scanner_enabled,helpdesk_enabled,selected_station)
 values(checker_id,'Synthetic Checker','code',null,'',true,true,true,false,'checker'),
       (faculty_id,'Synthetic Faculty','google',gen_random_uuid(),faculty_id::text||'@example.invalid',true,true,false,false,'');
 insert into navrang_private.report_grants(checker_id,enabled) values(faculty_id,true);
 insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(checker_token,'checker',checker_id,clock_timestamp()+interval '1 hour'),(faculty_token,'checker',faculty_id,clock_timestamp()+interval '1 hour');
 for i in 1..6 loop
  event_id:=navrang_private.append_notification_event(jsonb_build_object('key','fixture-'||i,'kind','announcement','actor','admin','title','Notice '||i,'body','Plain event update.','destination','notifications','audience',everyone),array['admin',checker_id::text]);
  if i=1 then first_id:=event_id;end if;
 end loop;
 feed:=public.navrang_communications('notifications-feed','{"afterRevision":0}',checker_token);
 if jsonb_array_length(feed->'items')<>5 or jsonb_array_length(feed->'activeIds')<>5 or feed->'activeIds' ? first_id::text then raise exception 'Sixth item did not prune the first';end if;
 if feed->'dashboard'->'totals' ? 'registered' or feed->'dashboard'->'totals' ? 'blocked' then raise exception 'Checker dashboard exposed administrator statistics';end if;
 select count(*) into before_count from navrang_private.notification_events;
 event_id:=navrang_private.append_notification_event(jsonb_build_object('key','fixture-6','kind','announcement','actor','admin','title','Notice 6','body','Plain event update.','destination','notifications','audience',everyone),array['admin',checker_id::text]);
 select count(*) into after_count from navrang_private.notification_events;
 if before_count<>after_count then raise exception 'Replayed source duplicated the event';end if;
 response:=public.navrang_communications('notifications-read',jsonb_build_object('id',event_id),checker_token);
 if coalesce((response->>'revision')::bigint,0)<=(feed->>'revision')::bigint then raise exception 'Read acknowledgement omitted authoritative newer center revision';end if;
 feed:=public.navrang_communications('notifications-feed','{}',checker_token);
 if response->>'read'<>'true' or jsonb_array_length(feed->'items')<>5 or not exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'id'=event_id::text and item->>'read'='true') then raise exception 'Reading removed or failed to mark item';end if;
 first_id:=(feed#>>'{items,0,id}')::uuid;
 perform public.navrang_communications('notifications-read',jsonb_build_object('id',feed#>>'{items,4,id}'),checker_token);
 feed:=public.navrang_communications('notifications-feed','{}',checker_token);
 if feed#>>'{items,0,id}'<>first_id::text then raise exception 'Reading older notification reordered recent event history';end if;
 response:=public.navrang_communications('notifications-dashboard','{"hidden":true}',checker_token);
 if coalesce((response->>'revision')::bigint,0)<=(feed->>'revision')::bigint then raise exception 'Dashboard acknowledgement omitted authoritative newer center revision';end if;
 feed:=public.navrang_communications('notifications-feed','{}',checker_token);
 if feed->'dashboard'->>'hidden'<>'true' or jsonb_array_length(feed->'items')<>5 then raise exception 'Dashboard occupied recent item slot or could not hide';end if;

 preview:=public.navrang_communications('notifications-preview',jsonb_build_object('template',announcement,'audience',everyone),admin_token);
 if (preview->>'recipientCount')::integer<>3 or length(preview->>'previewHash')<>64 then raise exception 'Preview did not resolve current authorized recipients';end if;
 payload:=jsonb_build_object('requestId',request_id,'template',announcement,'audience',everyone,'previewHash',preview->>'previewHash');
 sent:=public.navrang_communications('notifications-send',payload,admin_token);
 response:=public.navrang_communications('notifications-send',payload,admin_token);
 if sent->>'sent'<>'true' or response->>'replayed'<>'true' or sent->>'id'<>response->>'id' then raise exception 'Send retry was not idempotent';end if;
 response:=public.navrang_communications('notifications-send',jsonb_set(payload,'{template,title}','"Changed request"'),admin_token);
 if response->>'status'<>'409' then raise exception 'Request ID accepted a different announcement';end if;
 response:=public.navrang_communications('notifications-preview',jsonb_build_object('template',announcement,'audience',everyone),checker_token);
 if response->>'status'<>'403' then raise exception 'Checker gained composer authority';end if;
 update navrang_private.checkers set active=false where id=checker_id;
 response:=public.navrang_communications('notifications-send',payload||jsonb_build_object('requestId',gen_random_uuid()),admin_token);
 if response->>'status'<>'409' or response->>'previewChanged'<>'true' then raise exception 'Changing audience bypassed reviewed preview';end if;
 feed:=public.navrang_communications('notifications-feed','{}',checker_token);
 if exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'kind'<>'access-change') then raise exception 'Revoked staff retained previous operational notifications';end if;
 update navrang_private.checkers set active=true where id=checker_id;

 registration:=public.navrang_communications('notifications-device',jsonb_build_object('installationId','synthetic-install','bindingId',binding,'providerTarget',jsonb_build_object('type','fid','value','c123456789012345678901')),checker_token);
 if registration->>'registered'<>'true' or length(registration->>'unlinkProof')<>64 then raise exception 'Device did not receive scoped unlink capability';end if;
 response:=public.navrang_communications('notifications-device',jsonb_build_object('installationId','synthetic-install','bindingId',replacement,'providerTarget',jsonb_build_object('type','fid','value','c223456789012345678901')),faculty_token);
 if response->>'status'<>'409' then raise exception 'Another account hijacked known installation ID';end if;
 second_registration:=public.navrang_communications('notifications-device',jsonb_build_object('installationId','synthetic-install','bindingId',replacement,'providerTarget',jsonb_build_object('type','fid','value','c223456789012345678901'),'previousUnlinkProof',registration->>'unlinkProof'),faculty_token);
 if second_registration->>'registered'<>'true' then raise exception 'Installation ownership proof did not permit account replacement';end if;
 response:=public.navrang_communications('notifications-unregister',jsonb_build_object('installationId','synthetic-install','bindingId',binding,'unlinkProof',registration->>'unlinkProof'),'');
 if response->>'removed'='true' then raise exception 'Retired unlink proof removed replacement account binding';end if;
 response:=public.navrang_communications('notifications-unregister',jsonb_build_object('installationId','synthetic-install','bindingId',replacement,'unlinkProof',second_registration->>'unlinkProof'),'');
 if response->>'removed'<>'true' then raise exception 'Scoped unlink failed without old bearer';end if;
 if exists(select 1 from navrang_private.notification_devices where installation_id='synthetic-install') then raise exception 'Unlinked device retained binding';end if;

 second_registration:=public.navrang_communications('notifications-device',jsonb_build_object('installationId','synthetic-admin','bindingId',admin_binding,'providerTarget',jsonb_build_object('type','fid','value','c423456789012345678901')),admin_token);
 insert into navrang_private.tickets(id,name,amount,quantity,refund,description,eligible,reason)
 values('NTF00001','Synthetic admission',100,1,0,'Transaction successful',true,'');
 request_id:=gen_random_uuid();
 perform public.navrang_gate('checkin',jsonb_build_object('ticketId','NTF00001','requestId',request_id,'deviceId','synthetic'),checker_token);
 perform public.navrang_gate('checkin',jsonb_build_object('ticketId','NTF00001','requestId',request_id,'deviceId','synthetic'),checker_token);
 perform public.navrang_gate('checkin',jsonb_build_object('ticketId','NTF00001','requestId',gen_random_uuid(),'deviceId','synthetic'),checker_token);
 if (select sum(aggregate_count) from navrang_private.notification_events where kind='ticket-activity' and actor=checker_id::text)<>2 then raise exception 'Committed attempt aggregation lost/duplicated a request';end if;
 if not exists(select 1 from navrang_private.notification_events where kind='ticket-activity' and actor=checker_id::text and title like '%Synthetic Checker%') then raise exception 'Administrator activity omitted the acting staff member';end if;
 if (select count(*) from navrang_private.notification_outbox queue join navrang_private.notification_events event on event.id=queue.event_id where event.kind='ticket-activity' and queue.binding_id=admin_binding and queue.status='queued')<>1
  or exists(select 1 from navrang_private.notification_outbox queue join navrang_private.notification_events event on event.id=queue.event_id where event.kind='ticket-activity' and queue.binding_id=admin_binding and queue.status='queued' and next_attempt<=clock_timestamp()) then raise exception 'Ticket burst flooded immediate push jobs instead of one coalesced wake';end if;
 perform public.navrang_communications('notifications-unregister',jsonb_build_object('installationId','synthetic-admin','bindingId',admin_binding,'unlinkProof',second_registration->>'unlinkProof'),'');
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if exists(select 1 from jsonb_each(feed#>'{dashboard,totals}') where jsonb_typeof(value)<>'number') then raise exception 'Dashboard count contract included reporting provenance strings';end if;
 if exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'kind'='ticket-activity') then raise exception 'Faculty received ticket-check activity';end if;
 select count(*) into before_count from navrang_private.notification_events where kind='ticket-activity';
 insert into navrang_private.attempts(actor,request_id,ticket_id,device_id,response,test_fixture)
 values(checker_id::text,gen_random_uuid(),'NTF00001','fixture','{"code":"duplicate"}',true);
 if (select count(*) from navrang_private.notification_events where kind='ticket-activity')<>before_count then raise exception 'Test fixture generated live activity';end if;
 if not exists(select 1 from navrang_private.admissions where ticket_id='NTF00001') or (select count(*) from navrang_private.attempts where ticket_id='NTF00001' and not test_fixture)<>2 then raise exception 'Notification retention altered underlying admission/audits';end if;
 if to_regprocedure('navrang_private.claim_notification_deliveries(integer)') is null then raise exception 'Missing durable notification delivery worker helpers';end if;
 binding:=gen_random_uuid();
 registration:=public.navrang_communications('notifications-device',jsonb_build_object('installationId','synthetic-worker','bindingId',binding,'providerTarget',jsonb_build_object('type','fid','value','c323456789012345678901')),checker_token);
 preview:=public.navrang_communications('notifications-preview',jsonb_build_object('template',announcement,'audience',everyone),admin_token);
 perform public.navrang_communications('notifications-send',jsonb_build_object('requestId',gen_random_uuid(),'template',announcement,'audience',everyone,'previewHash',preview->>'previewHash'),admin_token);
 jobs:=navrang_private.claim_notification_deliveries(10);
 if jsonb_array_length(jobs)<>1 then raise exception 'Delivery did not lease the registered recipient job';end if;
 job:=jobs->0;
 response:=navrang_private.check_notification_delivery((job->>'id')::bigint,(job->>'leaseId')::uuid);
 if response->>'allowed'<>'true' or response#>>'{providerTarget,value}'<>'c323456789012345678901' or response ? 'body' then raise exception 'Delivery check lost binding or exposed private notification content';end if;
 response:=navrang_private.finish_notification_delivery((job->>'id')::bigint,(job->>'leaseId')::uuid,'retry');
 if response->>'completed'<>'true' or not exists(select 1 from navrang_private.notification_outbox where id=(job->>'id')::bigint and status='queued' and attempts=1 and next_attempt>clock_timestamp()) then raise exception 'Transient failure lacked bounded delayed retry';end if;
 if jsonb_array_length(navrang_private.claim_notification_deliveries(10))<>0 then raise exception 'Outbox retried before backoff deadline';end if;
 update navrang_private.notification_outbox set next_attempt=clock_timestamp()-interval '1 second' where id=(job->>'id')::bigint;
 jobs:=navrang_private.claim_notification_deliveries(10);job:=jobs->0;
 update navrang_private.checkers set active=false where id=checker_id;
 response:=navrang_private.check_notification_delivery((job->>'id')::bigint,(job->>'leaseId')::uuid);
 if response->>'allowed'='true' then raise exception 'Leased delivery ignored immediate access revocation';end if;
 jobs:=navrang_private.claim_notification_deliveries(10);job:=jobs->0;
 if job is null then raise exception 'Own access-change delivery was not queued';end if;
 perform navrang_private.finish_notification_delivery((job->>'id')::bigint,(job->>'leaseId')::uuid,'invalid');
 if exists(select 1 from navrang_private.notification_devices where binding_id=binding) then raise exception 'Permanent invalid target retained device registration';end if;
 update navrang_private.notification_outbox set at=clock_timestamp()-interval '8 days' where id=(job->>'id')::bigint;
 response:=navrang_private.prune_notification_operational();
 if (response->>'expiredFailures')::integer<1 or exists(select 1 from navrang_private.notification_outbox where id=(job->>'id')::bigint) then raise exception 'Operational outbox retention was unbounded';end if;
 if (select expired_failure_total from navrang_private.notification_config where singleton)<1 or not exists(select 1 from navrang_private.admissions where ticket_id='NTF00001') then raise exception 'Pruned failure count/audit preservation unavailable';end if;
 if navrang_private.resolve_communication_principal(repeat('-',36))->>'active'<>'false' then raise exception 'Malformed principal was accepted';end if;
 -- The pinned live item never consumes a recent-item position.
 announcement:=jsonb_build_object('type','live-broadcast','title','Live event','body','Coordinator speaking.','urgency','normal');
 preview:=public.navrang_communications('notifications-preview',jsonb_build_object('template',announcement,'audience',everyone),admin_token);
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);before_count:=jsonb_array_length(feed->'items');
 sent:=public.navrang_communications('notifications-send',jsonb_build_object('requestId',gen_random_uuid(),'template',announcement,'audience',everyone,'previewHash',preview->>'previewHash'),admin_token);
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if feed#>>'{dashboard,announcement,id}'<>sent->>'id' or jsonb_array_length(feed->'items')<>before_count then raise exception 'Pinned live card displaced recent notifications';end if;
 response:=public.navrang_communications('notifications-end',jsonb_build_object('id',sent->>'id'),faculty_token);
 if response->>'status'<>'403' then raise exception 'Faculty ended administrator live card';end if;
 perform public.navrang_communications('notifications-end',jsonb_build_object('id',sent->>'id'),admin_token);
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if feed->'dashboard' ? 'announcement' then raise exception 'Ended live card retained stale announcement';end if;
 announcement:=jsonb_build_object('type','meeting','title','Gate meeting','body','Coordinator briefing.','urgency','urgent','meetingLocation','North gate office','meetingTime','2026-10-19T05:00:00.000Z');
 preview:=public.navrang_communications('notifications-preview',jsonb_build_object('template',announcement,'audience',everyone),admin_token);
 if preview ? 'recipientIds' then raise exception 'Public preview exposed its private authorization snapshot';end if;
 sent:=public.navrang_communications('notifications-send',jsonb_build_object('requestId',gen_random_uuid(),'template',announcement,'audience',everyone,'previewHash',preview->>'previewHash'),admin_token);
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if not exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'id'=sent->>'id' and item->>'templateType'='meeting' and item->>'urgency'='urgent' and item->'meeting'='{"location":"North gate office","time":"2026-10-19T05:00:00.000Z"}'::jsonb) then raise exception 'Canonical template/urgency/meeting metadata was lost between preview send and feed';end if;
 if to_regprocedure('navrang_private.report_operation_event(jsonb)') is null then raise exception 'Missing current-authority report notification hook';end if;
 event_id:=gen_random_uuid();
 perform navrang_private.report_operation_event(jsonb_build_object('operationId',event_id,'actor',faculty_id,'kind','all','format','csv','outcome','prepared','deviceReported',false));
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'kind'='report-prepared') then raise exception 'Report preparation notified faculty as a completed download';end if;
 perform navrang_private.report_operation_event(jsonb_build_object('operationId',event_id,'actor',faculty_id,'kind','all','format','csv','outcome','saved','deviceReported',true));
 feed:=public.navrang_communications('notifications-feed','{}',faculty_token);
 if not exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'kind'='report-outcome' and item->>'body' like '%device-reported saved%') then raise exception 'Faculty save was not labelled as device-reported';end if;
 update navrang_private.report_grants set enabled=false where report_grants.checker_id=faculty_id;
 perform navrang_private.report_operation_event(jsonb_build_object('operationId',gen_random_uuid(),'actor',faculty_id,'kind','all','format','csv','outcome','saved','deviceReported',true));
 -- Fresh revocation prevents creating a recipient item for a stale save callback.
 if exists(select 1 from navrang_private.notification_items item join navrang_private.notification_events event on event.id=item.event_id where item.principal=faculty_id::text and event.kind='report-outcome' and navrang_private.notification_event_allowed(event.id,faculty_id::text)) then raise exception 'Revoked faculty retained report outcome access';end if;
 raise notice 'PASS: authoritative five, dashboard separate, idempotent preview/send, current audience, proof-bound devices, committed attempt aggregation and audit preservation';
end;
$test$;
