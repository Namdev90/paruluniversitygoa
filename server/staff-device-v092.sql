begin;

create table if not exists navrang_private.staff_device_invites (
 checker_id uuid primary key references navrang_private.checkers(id) on delete cascade,
 invite_hash text not null unique,
 expires_at timestamptz not null
);
create table if not exists navrang_private.staff_devices (
 checker_id uuid primary key references navrang_private.checkers(id) on delete cascade,
 device_hash text not null unique,
 invite_hash text not null,
 pin_proof text not null,
 failures integer not null default 0
);
revoke all on navrang_private.staff_device_invites, navrang_private.staff_devices from public, anon, authenticated;
alter table navrang_private.staff_device_invites enable row level security;
alter table navrang_private.staff_devices enable row level security;
grant select,insert,update,delete on navrang_private.staff_device_invites, navrang_private.staff_devices to service_role;

create or replace function public.navrang_staff_device(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,navrang_private as $$
declare
 staff navrang_private.checkers%rowtype;
 invite navrang_private.staff_device_invites%rowtype;
 device navrang_private.staff_devices%rowtype;
 fingerprint text:=p->>'deviceHash';
 proof text:=p->>'pinProof';
 invitation text:=coalesce(p->>'inviteHash','');
 actor jsonb;
 rejected constant jsonb:='{"error":"Verify this device with a setup code from your administrator.","status":403}';
begin
 if p_action='staff-device-issue' then
  actor:=public.navrang_gate('me','{}'::jsonb,p_token);
  if actor->>'role' is distinct from 'admin' or actor->>'active' is distinct from 'true' then
   return '{"error":"Administrator access required.","status":403}';
  end if;
  if invitation !~ '^[0-9a-f]{64}$' or coalesce(p->>'checkerId','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
   return '{"error":"Invalid device setup request.","status":400}';
  end if;
  select * into staff from navrang_private.checkers where id=(p->>'checkerId')::uuid;
  if not found or not staff.active or (staff.access_expires_at is not null and staff.access_expires_at<=now()) then
   return '{"error":"Choose an active staff account.","status":404}';
  end if;
  insert into navrang_private.staff_device_invites(checker_id,invite_hash,expires_at)
   values(staff.id,invitation,now()+interval '15 minutes')
   on conflict(checker_id) do update set invite_hash=excluded.invite_hash,expires_at=excluded.expires_at;
  return '{"issued":true}';
 end if;

 if p_action is distinct from 'staff-device-login' or coalesce(fingerprint,'') !~ '^[0-9a-f]{64}$' or
    coalesce(proof,'') !~ '^[0-9a-f]{64}$' or (invitation<>'' and invitation !~ '^[0-9a-f]{64}$') then
  return '{"error":"Invalid device sign-in request.","status":400}';
 end if;
 if invitation<>'' then
  select i.* into invite from navrang_private.staff_device_invites i
   where i.invite_hash=invitation and i.expires_at>now() for update;
  if found then
   select * into staff from navrang_private.checkers where id=invite.checker_id;
   if not found or not staff.active or (staff.access_expires_at is not null and staff.access_expires_at<=now()) then return rejected;end if;
   begin
    insert into navrang_private.staff_devices(checker_id,device_hash,invite_hash,pin_proof)
     values(staff.id,fingerprint,invitation,proof)
     on conflict(checker_id) do update set device_hash=excluded.device_hash,invite_hash=excluded.invite_hash,
       pin_proof=excluded.pin_proof,failures=0;
   exception when unique_violation then
    return '{"error":"This installation is already verified for another staff account.","status":409}';
   end;
   delete from navrang_private.staff_device_invites where checker_id=staff.id;
  end if;
 end if;

 -- A retry after a lost enrollment response uses the same enrolled credential.
 select d.* into device from navrang_private.staff_devices d where d.device_hash=fingerprint for update;
 if not found or (invitation<>'' and device.invite_hash<>invitation) or device.failures>=10 then return rejected;end if;
 select * into staff from navrang_private.checkers where id=device.checker_id;
 if not found or not staff.active or (staff.access_expires_at is not null and staff.access_expires_at<=now()) then return rejected;end if;
 if device.pin_proof<>proof then
  update navrang_private.staff_devices set failures=failures+1 where checker_id=device.checker_id;
  return '{"error":"Incorrect staff PIN.","status":401}';
 end if;
 if device.failures<>0 then update navrang_private.staff_devices set failures=0 where checker_id=device.checker_id;end if;
 return jsonb_build_object('checkerId',device.checker_id);
end;
$$;
revoke all on function public.navrang_staff_device(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_staff_device(text,jsonb,text) to service_role;
commit;
