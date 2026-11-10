begin;
create table if not exists navrang_private.message_replies (
 event_id uuid not null references navrang_private.notification_events(id) on delete cascade,
 principal text not null,
 reply text not null check(reply in ('Acknowledged','On my way','Need help')),
 primary key(event_id,principal)
);
alter table navrang_private.message_replies enable row level security;
revoke all on navrang_private.message_replies from public,anon,authenticated;
grant select,insert on navrang_private.message_replies to service_role;
create or replace function public.navrang_message_reply(p_action text,p jsonb,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 session_actor jsonb:=navrang_private.resolve_actor(p_token);
 item navrang_private.notification_events%rowtype;
 existing text;
 staff_name text;
begin
 if session_actor ? 'error' then return session_actor;end if;
 if not exists(select 1 from navrang_private.notification_config where singleton and center_enabled) then
  return '{"error":"Messaging is unavailable.","status":503}';
 end if;
 if session_actor->>'active' is distinct from 'true' or session_actor->>'admin'='true' then
  return '{"error":"Active staff access required.","status":403}';
 end if;
 if p_action is distinct from 'notifications-reply' or
    coalesce(p->>'id','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' or
    coalesce(p->>'reply','') not in ('Acknowledged','On my way','Need help') then
  return '{"error":"Choose a reply.","status":400}';
 end if;
 select e.* into item from navrang_private.notification_events e
 join navrang_private.notification_items i on i.event_id=e.id
 where e.id=(p->>'id')::uuid and i.principal=session_actor->>'principal'
 and e.actor='admin' and e.kind='announcement'
 and navrang_private.notification_event_allowed(e.id,session_actor->>'principal');
 if not found then return '{"error":"This message is unavailable.","status":404}';end if;
 insert into navrang_private.message_replies(event_id,principal,reply)
 values(item.id,session_actor->>'principal',p->>'reply') on conflict do nothing;
 select reply into existing from navrang_private.message_replies
 where event_id=item.id and principal=session_actor->>'principal';
 if existing<>p->>'reply' then return '{"error":"A reply was already sent.","status":409}';end if;
 select name into staff_name from navrang_private.checkers where id=(session_actor->>'principal')::uuid;
 perform navrang_private.append_notification_event(jsonb_build_object(
  'key','reply:'||item.id||':'||(session_actor->>'principal'),'kind','announcement',
  'actor',session_actor->>'principal','title',left(staff_name||' replied',100),
  'body',existing||' — '||item.title,'destination','notifications',
  'audience',jsonb_build_object('type','roles','roles',jsonb_build_array('administrator')),
  'template',jsonb_build_object('type','announcement','urgency',
   case when existing='Need help' then 'urgent' else 'normal' end)),array['admin']);
 perform navrang_private.notification_rpc('notifications-read',jsonb_build_object('id',item.id),p_token);
 return jsonb_build_object('reply',existing);
end;
$$;
revoke all on function public.navrang_message_reply(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.navrang_message_reply(text,jsonb,text) to service_role;
commit;
