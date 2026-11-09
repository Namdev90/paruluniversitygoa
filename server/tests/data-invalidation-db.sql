-- Synthetic rollback fixture only: no real delivery or person is involved.
do $data_hints$
declare
 admin_token text:=encode(extensions.gen_random_bytes(32),'hex');
 staff_token text:=encode(extensions.gen_random_bytes(32),'hex'); staff_id uuid:=gen_random_uuid();
 admin_binding uuid:=gen_random_uuid(); staff_binding uuid:=gen_random_uuid(); lease uuid;
 revision bigint; first_event uuid; latest_event uuid; access_event uuid; job_id bigint;
 before_staff bigint; result jsonb; before_events bigint;
begin
 update navrang_private.notification_config set center_enabled=true,delivery_enabled=true where singleton;
 insert into navrang_private.sessions(hash,role,expires_at) values(admin_token,'admin',clock_timestamp()+interval '1 hour');
 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station)
 values(staff_id,'Synthetic data hint recipient','code',true,true,true,'checker');
 insert into navrang_private.sessions(hash,role,checker_id,expires_at) values(staff_token,'checker',staff_id,clock_timestamp()+interval '1 hour');
 perform public.navrang_communications('notifications-device',jsonb_build_object('installationId','data-admin-'||admin_binding,'bindingId',admin_binding,'registrationRevision',1,'unlinkProof',repeat('6',64),'providerTarget',jsonb_build_object('type','legacyToken','value','synthetic-admin-device')),admin_token);
 perform public.navrang_communications('notifications-device',jsonb_build_object('installationId','data-staff-'||staff_binding,'bindingId',staff_binding,'registrationRevision',1,'unlinkProof',repeat('7',64),'providerTarget',jsonb_build_object('type','legacyToken','value','synthetic-staff-device')),staff_token);
 select count(*) into before_staff from navrang_private.notification_items where principal=staff_id::text;
 update navrang_private.event set data_revision=data_revision+1 where id='O9KL3' returning data_revision into revision;
 select event_id into first_event from navrang_private.notification_sources where source_key='dataset:O9KL3:'||revision;
 if first_event is null then raise exception 'Registration revision did not produce a private data hint';end if;
 update navrang_private.event set data_revision=data_revision+1 where id='O9KL3' returning data_revision into revision;
 select event_id into latest_event from navrang_private.notification_sources where source_key='dataset:O9KL3:'||revision;
 if latest_event is distinct from first_event then raise exception 'One statement burst did not coalesce';end if;
 if (select count(*) from navrang_private.notification_outbox where event_id=latest_event and status='queued')<>1
  or exists(select 1 from navrang_private.notification_outbox where event_id=latest_event and principal<>'admin') then raise exception 'Data hint fanned out beyond the authorized administrator';end if;
 if exists(select 1 from navrang_private.notification_outbox where event_id=latest_event and status='queued' and next_attempt<=clock_timestamp()) then raise exception 'Burst hint lost its coalescing delay';end if;
 if (select body from navrang_private.notification_events where id=latest_event) not like '%registration%' then raise exception 'Registration burst reported a false ticket-check total';end if;
 if (select count(*) from navrang_private.notification_items where principal=staff_id::text)<>before_staff then raise exception 'Registration master hint leaked to staff';end if;
 select count(*) into before_events from navrang_private.notification_sources;
 update navrang_private.event set data_revision=data_revision where id='O9KL3';
 if (select count(*) from navrang_private.notification_sources)<>before_events then raise exception 'No-op revision generated a request';end if;
 lease:=gen_random_uuid();
 update navrang_private.notification_outbox set status='leased',lease_id=lease,lease_until=clock_timestamp()+interval '1 minute'
 where event_id=latest_event and status='queued' returning id into job_id;
 result:=navrang_private.check_notification_delivery(job_id,lease);
 if result->>'allowed'<>'true' or result->>'domain' is distinct from 'records' then raise exception 'Fresh authorized delivery lacks the records hint';end if;
 if result ?| array['latitude','longitude','records','principal','profile','token'] then raise exception 'Private data appeared in an invalidation envelope';end if;
 access_event:=navrang_private.append_notification_event(jsonb_build_object('key','data-access-'||staff_id,'kind','access-change','actor',staff_id::text,'title','Access changed','body','Synthetic access change','destination','account'),array['admin',staff_id::text]);
 lease:=gen_random_uuid();
 update navrang_private.notification_outbox set status='leased',lease_id=lease,lease_until=clock_timestamp()+interval '1 minute'
 where event_id=access_event and binding_id=admin_binding returning id into job_id;
 result:=navrang_private.check_notification_delivery(job_id,lease);
 if result->>'domain' is distinct from 'staff' then raise exception 'Admin staff change caused an unnecessary own-auth refresh';end if;
 lease:=gen_random_uuid();
 update navrang_private.notification_outbox set status='leased',lease_id=lease,lease_until=clock_timestamp()+interval '1 minute'
 where event_id=access_event and binding_id=staff_binding returning id into job_id;
 result:=navrang_private.check_notification_delivery(job_id,lease);
 if result->>'domain' is distinct from 'access' then raise exception 'Affected principal did not receive own-access invalidation';end if;
 delete from navrang_private.sessions where hash=staff_token;
 result:=navrang_private.check_notification_delivery(job_id,lease);
 if result->>'allowed' is distinct from 'false' or result ? 'domain' then raise exception 'Revoked binding retained invalidation authority';end if;
 if has_function_privilege('anon','navrang_private.notification_dataset_changed()','EXECUTE')
  or has_function_privilege('authenticated','navrang_private.notification_dataset_changed()','EXECUTE')
  or (select prosecdef from pg_proc where oid='navrang_private.notification_dataset_changed()'::regprocedure) then raise exception 'Dataset trigger expanded public access';end if;
end;
$data_hints$;
