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
