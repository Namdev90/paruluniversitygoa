begin;
update navrang_private.notification_config set center_enabled=true,delivery_enabled=false;
insert into navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled)
 values('10000000-0000-4000-8000-000000000093','Synthetic Staff','code',true,true,true);
insert into navrang_private.sessions(hash,role,checker_id,expires_at)
 values(repeat('9',64),'checker','10000000-0000-4000-8000-000000000093',now()+interval '1 hour');
set local role service_role;
do $$
declare message_id uuid;result jsonb;
begin
 message_id:=navrang_private.append_notification_event(jsonb_build_object(
  'key','synthetic-reply-093','kind','announcement','actor','admin',
  'title','Please check the north gate','body','Synthetic request','destination','notifications',
  'audience',jsonb_build_object('type','everyone')),array['10000000-0000-4000-8000-000000000093']);
 result:=public.navrang_message_reply('notifications-reply',jsonb_build_object('id',message_id,'reply','Need help'),'');
 assert result ? 'error';
 result:=public.navrang_message_reply('notifications-reply',jsonb_build_object('id',message_id,'reply','Need help'),repeat('9',64));
 assert result->>'reply'='Need help',result::text;
 result:=public.navrang_message_reply('notifications-reply',jsonb_build_object('id',message_id,'reply','Need help'),repeat('9',64));
 assert result->>'reply'='Need help';
 result:=public.navrang_message_reply('notifications-reply',jsonb_build_object('id',message_id,'reply','Acknowledged'),repeat('9',64));
 assert result->>'status'='409';
 assert (select count(*) from navrang_private.notification_events where event_key='reply:'||message_id||':10000000-0000-4000-8000-000000000093')=1;
 assert not has_function_privilege('anon','public.navrang_message_reply(text,jsonb,text)','execute');
end $$;
rollback;
