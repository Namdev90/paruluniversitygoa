-- Disposable PostgreSQL only; caller owns BEGIN / SET LOCAL ROLE / ROLLBACK.
do $test$
declare
 r jsonb; fid uuid; original_idle timestamptz; staff uuid:=gen_random_uuid();
 request_one uuid:='12345678-1234-4234-9234-123456789abc';
 request_two uuid:='12345678-1234-4234-9234-123456789abd';
begin
 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('0',64),'role','admin'),'');
 if r ? 'refreshFamilyId' or (r->>'expiresAt')::timestamptz<clock_timestamp()+interval '11 hours 59 minutes' then raise exception 'Legacy session compatibility changed';end if;

 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('1',64),'role','admin','refreshHash',repeat('a',64),'installationId','fixture-device'),'');
 if r->>'refreshFamilyId' is null then raise exception 'Renewable family was not created';end if;
 fid:=(r->>'refreshFamilyId')::uuid;
 if r->'profile'->>'role'<>'admin' or not exists(select 1 from navrang_private.sessions where hash=repeat('1',64) and family_id=fid and expires_at<=clock_timestamp()+interval '15 minutes 1 second' and expires_at>clock_timestamp()+interval '14 minutes 59 seconds') then raise exception 'Access session is not fifteen minutes';end if;
 if not exists(select 1 from navrang_private.session_families where id=fid and absolute_expires_at between clock_timestamp()+interval '29 days 23 hours 59 minutes' and clock_timestamp()+interval '30 days 1 minute' and idle_expires_at between clock_timestamp()+interval '6 days 23 hours 59 minutes' and clock_timestamp()+interval '7 days 1 minute') then raise exception 'Family deadlines incorrect';end if;

 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('2',64),'refreshHash',repeat('a',64),'nextRefreshHash',repeat('b',64),'requestId',request_one,'installationId','wrong-device'),'');
 if coalesce((r->>'status')::int,0)<>401 then raise exception 'Wrong installation accepted';end if;
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('2',64),'refreshHash',repeat('a',64),'nextRefreshHash',repeat('b',64),'requestId',request_one,'installationId','fixture-device'),'');
 if r->>'refreshFamilyId'<>fid::text or r->'profile'->>'role'<>'admin' then raise exception 'Rotation failed';end if;
 if exists(select 1 from navrang_private.sessions where hash=repeat('1',64)) then raise exception 'Old family access remained valid after rotation';end if;
 select idle_expires_at into original_idle from navrang_private.session_families where id=fid;
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('3',64),'refreshHash',repeat('a',64),'nextRefreshHash',repeat('b',64),'requestId',request_one,'installationId','fixture-device'),'');
 if r ? 'error' or (select idle_expires_at from navrang_private.session_families where id=fid)<>original_idle then raise exception 'Exact bounded retry failed or extended inactivity';end if;
 if exists(select 1 from navrang_private.sessions where hash=repeat('2',64)) then raise exception 'Retry left multiple active access tokens';end if;
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('4',64),'refreshHash',repeat('a',64),'nextRefreshHash',repeat('c',64),'requestId',request_two,'installationId','fixture-device'),'');
 if coalesce((r->>'status')::int,0)<>401 or not exists(select 1 from navrang_private.session_families where id=fid and revoked_at is not null) or exists(select 1 from navrang_private.sessions where family_id=fid) then raise exception 'Refresh reuse did not revoke the entire family';end if;

 insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station,access_expires_at) values(staff,'Synthetic renewal volunteer','code',true,true,true,'checker',clock_timestamp()+interval '45 seconds');
 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('5',64),'role','checker','checkerId',staff,'refreshHash',repeat('d',64),'installationId','staff-fixture'),'');
 fid:=(r->>'refreshFamilyId')::uuid;
 if (r->'profile'->>'expiresAt')::timestamptz>clock_timestamp()+interval '46 seconds' then raise exception 'Volunteer access deadline ignored';end if;
 update navrang_private.checkers set active=false where id=staff;
 if exists(select 1 from navrang_private.sessions where family_id=fid) or not exists(select 1 from navrang_private.session_families where id=fid and revoked_at is not null) then raise exception 'Account revocation left renewable access';end if;

 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('6',64),'role','admin','refreshHash',repeat('e',64),'installationId','logout-fixture'),'');
 fid:=(r->>'refreshFamilyId')::uuid;
 r:=public.navrang_gate('session-revoke',jsonb_build_object('refreshHash',repeat('e',64),'installationId','logout-fixture'),'');
 if r->>'signedOut'<>'true' or exists(select 1 from navrang_private.sessions where family_id=fid) then raise exception 'Refresh-holder logout failed';end if;
 if not exists(select 1 from navrang_private.sessions where hash=repeat('0',64)) then raise exception 'One device logout revoked unrelated legacy access';end if;

 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('7',64),'role','admin','refreshHash',repeat('f',64),'installationId','uppercase-fixture'),'');
 fid:=(r->>'refreshFamilyId')::uuid;
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('8',64),'refreshHash',repeat('f',64),'nextRefreshHash',repeat('a1',32),'requestId',upper(request_one::text),'installationId','uppercase-fixture'),'');
 if r ? 'error' then raise exception 'Contract-valid uppercase UUID was rejected';end if;
 update navrang_private.session_refresh_tokens set consumed_at=clock_timestamp()-interval '31 seconds' where hash=repeat('f',64);
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('9',64),'refreshHash',repeat('f',64),'nextRefreshHash',repeat('a1',32),'requestId',request_one,'installationId','uppercase-fixture'),'');
 if coalesce((r->>'status')::int,0)<>401 or exists(select 1 from navrang_private.sessions where family_id=fid) then raise exception 'Retry outside thirty seconds remained authorized';end if;

 r:=public.navrang_gate('session-create',jsonb_build_object('hash',repeat('a2',32),'role','admin','refreshHash',repeat('a3',32),'installationId','idle-fixture'),'');
 fid:=(r->>'refreshFamilyId')::uuid;
 update navrang_private.session_families set idle_expires_at=clock_timestamp()-interval '1 millisecond' where id=fid;
 r:=public.navrang_gate('session-refresh',jsonb_build_object('hash',repeat('a4',32),'refreshHash',repeat('a3',32),'nextRefreshHash',repeat('a5',32),'requestId',request_one,'installationId','idle-fixture'),'');
 if coalesce((r->>'status')::int,0)<>401 or exists(select 1 from navrang_private.sessions where family_id=fid) then raise exception 'Idle family renewed after expiry';end if;
 if has_function_privilege('anon','public.navrang_gate(text,jsonb,text)','execute') or has_function_privilege('authenticated','public.navrang_gate_before_renewal_v090(text,jsonb,text)','execute') or has_table_privilege('authenticated','navrang_private.session_refresh_tokens','select') then raise exception 'Renewal exposed a client table or RPC grant';end if;
end;
$test$;
