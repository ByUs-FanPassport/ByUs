begin;

do $$
declare
  v_name text;
begin
  if exists (
    select 1 from (values ('anon'::name),('authenticated'::name)) roles(name)
    where has_function_privilege(name,'public.public_fan_avatar_url(uuid)','execute')
       or has_function_privilege(name,'public.read_public_avatar_image(uuid,integer)','execute')
  ) or not has_function_privilege('service_role','public.public_fan_avatar_url(uuid)','execute')
    or not has_function_privilege('service_role','public.read_public_avatar_image(uuid,integer)','execute') then
    raise exception 'public avatar RPC grant boundary is wrong';
  end if;

  if exists (
    select 1 from (values ('anon'::name),('authenticated'::name),('service_role'::name)) roles(name)
    where has_table_privilege(name,'public.app_user_avatars','select')
  ) then
    raise exception 'private avatar table became directly readable';
  end if;

  if (select public from storage.buckets where id='fan-avatars') is distinct from false then
    raise exception 'fan avatar bucket is public';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('public_fan_avatar_url','read_public_avatar_image')
      and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false))
  ) then
    raise exception 'public avatar RPC security-definer search path is unsafe';
  end if;

  select a.attname into v_name
  from pg_catalog.pg_attribute a
  where a.attrelid='public.app_user_avatars'::regclass
    and a.attname='public_image_id' and a.attnotnull and not a.attisdropped;
  if v_name is null or not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.app_user_avatars'::regclass
      and c.contype='u'
      and pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (public_image_id)'
  ) then
    raise exception 'public image identifier column contract is incomplete';
  end if;
end $$;

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('a1000000-0000-4000-8000-000000000001','did:privy:public-avatar-upload','public-avatar-upload@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000002','did:privy:public-avatar-google','public-avatar-google@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000003','did:privy:public-avatar-character','public-avatar-character@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000004','did:privy:public-avatar-disabled','public-avatar-disabled@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000005','did:privy:public-avatar-none','public-avatar-none@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000006','did:privy:public-avatar-delete','public-avatar-delete@byus.test','active');

insert into public.app_user_avatars(
  app_user_id,initial_character_id,selected_character_id,source,object_path,revision,public_image_id
) values
  ('a1000000-0000-4000-8000-000000000001','star-cream','heart-pink','upload','a1000000-0000-4000-8000-000000000001/3-a2000000-0000-4000-8000-000000000001.webp',3,'b1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002','star-lavender','heart-cream','google','a1000000-0000-4000-8000-000000000002/2-a2000000-0000-4000-8000-000000000002.webp',2,'b1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003','ghost-cream','fairy-lavender','character',null,4,'b1000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000004','heart-cream','heart-cream','upload','a1000000-0000-4000-8000-000000000004/1-a2000000-0000-4000-8000-000000000004.webp',1,'b1000000-0000-4000-8000-000000000004'),
  ('a1000000-0000-4000-8000-000000000006','star-pink','star-pink','upload','a1000000-0000-4000-8000-000000000006/1-a2000000-0000-4000-8000-000000000006.webp',1,'b1000000-0000-4000-8000-000000000006');

update public.app_users set status='disabled'
where id='a1000000-0000-4000-8000-000000000004';

set local role service_role;

do $$
declare
  v_upload_id uuid;
  v_google_id uuid;
  v_deleted_id uuid;
  v_url text;
begin
  v_upload_id := 'b1000000-0000-4000-8000-000000000001';
  v_google_id := 'b1000000-0000-4000-8000-000000000002';
  v_deleted_id := 'b1000000-0000-4000-8000-000000000006';

  v_url := public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000001');
  if v_url is distinct from '/api/fan-avatars/'||v_upload_id||'?revision=3'
    or v_url like '%a1000000-0000-4000-8000-000000000001%'
    or v_url like '%.webp%' then
    raise exception 'upload avatar public URL is unsafe or unstable: %',v_url;
  end if;
  if public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000002')
      is distinct from '/api/fan-avatars/'||v_google_id||'?revision=2' then
    raise exception 'google avatar is not public by default';
  end if;
  if public.read_public_avatar_image(v_upload_id,3)
      is distinct from '{"objectPath":"a1000000-0000-4000-8000-000000000001/3-a2000000-0000-4000-8000-000000000001.webp"}'::jsonb
    or public.read_public_avatar_image(v_upload_id,2) is not null
    or public.read_public_avatar_image('a9999999-0000-4000-8000-000000000099',3) is not null then
    raise exception 'public image lookup did not enforce current exact revision';
  end if;
  if public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000003')
      is distinct from '/images/avatars/fairy-lavender.webp'
    or public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000004')
      is distinct from '/images/avatars/star-pink.webp'
    or public.read_public_avatar_image('b1000000-0000-4000-8000-000000000004',1) is not null
    or public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000005')
      is distinct from '/images/avatars/star-pink.webp'
    or public.public_fan_avatar_url('a9999999-0000-4000-8000-000000000099')
      is distinct from '/images/avatars/star-pink.webp' then
    raise exception 'character, inactive, missing-row or missing-user fallback is wrong';
  end if;
end $$;

reset role;

do $$
declare
  v_public_id uuid;
  v_state jsonb;
begin
  select public_image_id into v_public_id from public.app_user_avatars
    where app_user_id='a1000000-0000-4000-8000-000000000001';
  v_state := public.set_owned_avatar_image(
    'a1000000-0000-4000-8000-000000000001','upload',
    'a1000000-0000-4000-8000-000000000001/4-a2000000-0000-4000-8000-000000000011.webp',3
  );
  if (select public_image_id from public.app_user_avatars where app_user_id='a1000000-0000-4000-8000-000000000001') is distinct from v_public_id
    or public.read_public_avatar_image(v_public_id,3) is not null
    or public.read_public_avatar_image(v_public_id,4)->>'objectPath'
      is distinct from 'a1000000-0000-4000-8000-000000000001/4-a2000000-0000-4000-8000-000000000011.webp' then
    raise exception 'image replacement changed public identity or exposed a stale revision';
  end if;

  v_state := public.remove_owned_avatar('a1000000-0000-4000-8000-000000000001',4);
  if (select public_image_id from public.app_user_avatars where app_user_id='a1000000-0000-4000-8000-000000000001') is distinct from v_public_id
    or public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000001')
      is distinct from '/images/avatars/star-cream.webp'
    or public.read_public_avatar_image(v_public_id,5) is not null then
    raise exception 'image removal changed public identity or retained public image access';
  end if;

  select public_image_id into v_public_id from public.app_user_avatars
    where app_user_id='a1000000-0000-4000-8000-000000000006';
  delete from public.app_user_avatars where app_user_id='a1000000-0000-4000-8000-000000000006';
  if exists(select 1 from public.app_user_avatars where app_user_id='a1000000-0000-4000-8000-000000000006')
    or public.read_public_avatar_image(v_public_id,1) is not null
    or public.public_fan_avatar_url('a1000000-0000-4000-8000-000000000006')
      is distinct from '/images/avatars/star-pink.webp' then
    raise exception 'avatar row deletion did not revoke public avatar access';
  end if;
end $$;

do $$
declare
  v_projection record;
  v_source text;
begin
  for v_projection in select * from (values
    ('public.read_celebrity_fan_community(text,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(e.app_user_id)'),
    ('public.read_celebrity_fanpage(text,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(e.app_user_id)'),
    ('public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text)'::regprocedure,'public.public_fan_avatar_url(r.app_user_id)'),
    ('public.fan_web_post_json(uuid,uuid,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(p.app_user_id)'),
    ('public.read_fan_post_comments(uuid,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(x.app_user_id)'),
    ('public.read_content_blocks(uuid,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(u.id)'),
    ('public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(v.app_user_id)'),
    ('public.read_celebrity_cheers(text,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(v.app_user_id)'),
    ('public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale)'::regprocedure,'public.public_fan_avatar_url(p.app_user_id)'),
    ('public.read_unified_creator_feed(uuid,text,text,text,integer,timestamptz,text,uuid,integer,public.content_locale)'::regprocedure,'public.public_fan_avatar_url(m.app_user_id)'),
    ('public.fan_web_list_live_submissions(uuid,text,public.content_locale,timestamptz,uuid,integer)'::regprocedure,'public.public_fan_avatar_url(r.app_user_id)'),
    ('public.fan_web_admin_review_live_submission(uuid,uuid,uuid,uuid,integer,text,text)'::regprocedure,'public.public_fan_avatar_url(r.app_user_id)'),
    ('public.fan_web_admin_list_live_submissions(uuid,uuid,uuid,uuid,text,timestamptz,uuid,integer)'::regprocedure,'public.public_fan_avatar_url(r.app_user_id)')
  ) projections(signature,expected) loop
    v_source := pg_catalog.pg_get_functiondef(v_projection.signature);
    if (length(v_source)-length(replace(v_source,v_projection.expected,'')))/length(v_projection.expected) <> 1 then
      raise exception 'public avatar projection missing from %',v_projection.signature;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname<>'public_fan_avatar_url'
      and p.prosrc like '%/images/avatars/%' and p.prosrc like '%selected_character_id%'
  ) then
    raise exception 'an active function still projects character-only avatars';
  end if;
end $$;

rollback;
