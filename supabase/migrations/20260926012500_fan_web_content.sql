-- Fan-authored content is separate from legacy cheer/comment reward producers.
alter table public.celebrity_notices
  add column post_type text not null default 'notice' check(post_type in ('notice','artist_post')),
  add column visibility text not null default 'public' check(visibility in ('public','members'));

create table public.fan_posts (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  body text not null check(length(body)<=5000),
  visibility text not null default 'public' check(visibility in ('public','members')),
  revision integer not null default 1 check(revision>0),
  idempotency_key uuid not null, create_request_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, hidden_at timestamptz,
  hidden_by_admin_id uuid references public.admin_allowlist(id) on delete restrict,
  hide_reason text,
  unique(app_user_id,idempotency_key)
);
create index fan_posts_feed on public.fan_posts(celebrity_id,created_at desc,id desc) where deleted_at is null and hidden_at is null;
create index fan_posts_owner on public.fan_posts(app_user_id,created_at desc);

create table public.fan_post_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  post_id uuid not null references public.fan_posts(id) on delete restrict,
  parent_id uuid references public.fan_post_comments(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  body text not null,
  revision integer not null default 1 check(revision>0), idempotency_key uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, hidden_at timestamptz,
  hidden_by_admin_id uuid references public.admin_allowlist(id) on delete restrict,
  hide_reason text,
  check(deleted_at is not null or length(btrim(body)) between 1 and 1000),
  check(parent_id is distinct from id), unique(app_user_id,idempotency_key)
);
create index fan_post_comments_feed on public.fan_post_comments(post_id,created_at desc,id desc) where deleted_at is null and hidden_at is null;
create index fan_post_comments_owner on public.fan_post_comments(app_user_id,created_at desc);

create table public.fan_post_likes (
  post_id uuid not null references public.fan_posts(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(), primary key(post_id,app_user_id)
);
create table public.content_write_events (
  id bigint generated always as identity primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  kind text not null check(kind in ('like','post_edit')),
  created_at timestamptz not null default now()
);
create index content_write_events_rate on public.content_write_events(app_user_id,kind,created_at desc);

create table public.content_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  storage_path text not null unique, mime_type text not null default 'image/webp' check(mime_type='image/webp'),
  byte_size integer not null check(byte_size between 1 and 8388608),
  width integer not null check(width>0), height integer not null check(height>0),
  sha256 text not null check(sha256~'^[a-f0-9]{64}$'), uploaded_at timestamptz,
  upload_settled_at timestamptz, upload_expires_at timestamptz not null default now()+interval '1 hour',
  post_id uuid references public.fan_posts(id) on delete restrict,
  notice_id uuid references public.celebrity_notices(id) on delete restrict,
  position smallint check(position between 0 and 3),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
  deleted_at timestamptz, cleanup_requested_at timestamptz, cleanup_retry_at timestamptz, storage_deleted_at timestamptz,
  cleanup_generation bigint not null default 0,
  check(not(post_id is not null and notice_id is not null)),
  check(width::bigint*height::bigint<=40000000)
);
create unique index content_assets_post_position on public.content_assets(post_id,position) where deleted_at is null;
create index content_assets_cleanup on public.content_assets(cleanup_retry_at,expires_at) where storage_deleted_at is null;
create index content_assets_owner on public.content_assets(app_user_id,created_at desc);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fan-content-assets','fan-content-assets',false,8388608,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.content_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  target_type text not null check(target_type in ('fan_post','fan_post_comment','notice','notice_comment','cheer','live_submission')),
  target_id uuid not null, target_revision integer not null,
  target_app_user_id uuid references public.app_users(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 1 and 500), idempotency_key uuid not null,
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(), resolved_at timestamptz,
  resolved_by_admin_id uuid references public.admin_allowlist(id) on delete restrict,
  resolution_reason text, target_hidden boolean not null default false,
  unique(app_user_id,idempotency_key), unique(app_user_id,target_type,target_id,target_revision)
);
create index content_reports_queue on public.content_reports(status,created_at desc,id desc);
create table public.content_translations (
  target_type text not null, target_id uuid not null, source_revision integer not null,
  source_hash text not null, source_locale text not null, target_locale text not null,
  source_app_user_id uuid references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  translated_text text not null, detected_source_locale text, created_at timestamptz not null default now(),
  primary key(target_type,target_id,source_revision,source_hash,source_locale,target_locale),
  check(target_type in ('fan_post','fan_post_comment','notice','notice_comment','cheer','live_submission')),
  check(target_locale in ('ko','en','ja','zh-Hans','zh-Hant','es','id','vi','th','pt','fr'))
);
create index content_translations_owner on public.content_translations(source_app_user_id);
create table public.content_translation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid references public.app_users(id) on delete set null,
  character_count integer not null check(character_count between 1 and 20000),
  created_at timestamptz not null default now()
);
create index content_translation_requests_rate on public.content_translation_requests(created_at,app_user_id);

do $$ declare t text; begin
  foreach t in array array['fan_posts','fan_post_comments','fan_post_likes','content_write_events','content_assets','content_reports','content_translations','content_translation_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- One predicate supplies list/detail/count/translation/notification authorization.
create function public.fan_web_content_target(p_app_user_id uuid,p_target_type text,p_target_id uuid,p_locale public.content_locale default 'ko')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid; creator_id uuid; creator_slug text; source_body text; source_revision integer:=1;
  source_locale text:='und'; target_link text; target_parent_id uuid; target_post_id uuid; parent_target jsonb; row_record record;
begin
  if p_app_user_id is not null and not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then return null; end if;
  if p_target_type='fan_post' then
    select * into row_record from public.fan_posts where id=p_target_id and deleted_at is null and hidden_at is null;
    if not found then return null; end if;
    owner_id:=row_record.app_user_id; creator_id:=row_record.celebrity_id; source_body:=row_record.body; source_revision:=row_record.revision;
    if row_record.visibility='members' and not public.fan_web_is_member(p_app_user_id,creator_id) then return null; end if;
    target_link:='/community/'||p_target_id::text;
  elsif p_target_type='fan_post_comment' then
    select * into row_record from public.fan_post_comments where id=p_target_id and deleted_at is null and hidden_at is null;
    if not found then return null; end if;
    owner_id:=row_record.app_user_id; source_body:=row_record.body; source_revision:=row_record.revision;
    target_parent_id:=row_record.parent_id; target_post_id:=row_record.post_id;
    parent_target:=public.fan_web_content_target(p_app_user_id,'fan_post',target_post_id,p_locale);
    if parent_target is null then return null; end if;
    creator_id:=(parent_target->>'celebrityId')::uuid;
    if target_parent_id is not null then
      if not exists(select 1 from public.fan_post_comments x where x.id=target_parent_id and x.parent_id is null and x.post_id=row_record.post_id) then return null; end if;
      if public.fan_web_content_target(p_app_user_id,'fan_post_comment',target_parent_id,p_locale) is null then return null; end if;
    end if;
    target_link:='/community/'||target_post_id::text||'#comment-'||p_target_id::text;
  elsif p_target_type='notice' then
    select n.*,l.title,l.body_json into row_record from public.celebrity_notices n join public.celebrity_notice_localizations l on l.notice_id=n.id and l.locale=p_locale
    where n.id=p_target_id and n.publication_status='published' and n.archived_at is null;
    if not found then return null; end if;
    creator_id:=row_record.celebrity_id; source_revision:=row_record.revision; source_locale:=p_locale::text;
    if row_record.visibility='members' and not public.fan_web_is_member(p_app_user_id,creator_id) then return null; end if;
    select row_record.title||E'\n\n'||coalesce(string_agg(t.value#>>'{}',E'\n'),'') into source_body
    from jsonb_path_query(row_record.body_json,'strict $.**.text') t(value);
    target_link:='/notices/'||row_record.slug;
  elsif p_target_type='notice_comment' then
    select * into row_record from public.celebrity_notice_comments where id=p_target_id and removed_at is null;
    if not found then return null; end if;
    owner_id:=row_record.app_user_id; source_body:=row_record.body;
    parent_target:=public.fan_web_content_target(p_app_user_id,'notice',row_record.notice_id,p_locale);
    if parent_target is null then return null; end if;
    creator_id:=(parent_target->>'celebrityId')::uuid; target_link:=(parent_target->>'deepLink')||'#comment-'||p_target_id::text;
  elsif p_target_type='cheer' then
    select * into row_record from public.fan_lounge_messages where id=p_target_id and removed_at is null and reply_to_id is null;
    if not found then return null; end if;
    owner_id:=row_record.app_user_id; creator_id:=row_record.celebrity_id; source_body:=row_record.body; target_link:='#cheers';
  elsif p_target_type='live_submission' then
    parent_target:=public.fan_web_get_live_submission_target(p_app_user_id,p_target_id);
    if parent_target is null then return null; end if;
    owner_id:=(parent_target->>'appUserId')::uuid; creator_id:=(parent_target->>'celebrityId')::uuid;
    source_body:=parent_target->>'body'; source_revision:=(parent_target->>'revision')::integer;
    target_link:='/live/'||(parent_target->>'liveSlug')||'#submission-'||p_target_id::text;
  else return null;
  end if;
  select slug into creator_slug from public.celebrities where id=creator_id and status='published' and archived_at is null;
  if creator_slug is null then return null; end if;
  if owner_id is not null and (not exists(select 1 from public.app_users where id=owner_id and status='active') or public.fan_web_blocked(p_app_user_id,owner_id)) then return null; end if;
  if p_target_type not in ('notice_comment','live_submission') then target_link:='/c/'||creator_slug||target_link; end if;
  return jsonb_build_object('targetType',p_target_type,'targetId',p_target_id,'celebrityId',creator_id,'celebritySlug',creator_slug,
    'appUserId',owner_id,'revision',source_revision,'sourceLocale',source_locale,'body',source_body,
    'sourceHash',encode(extensions.digest(source_body,'sha256'),'hex'),'deepLink',target_link);
end $$;

create function public.fan_web_content_visible(p_app_user_id uuid,p_target_type text,p_target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.fan_web_content_target(p_app_user_id,p_target_type,p_target_id) is not null;
$$;

create function public.fan_web_post_json(p_app_user_id uuid,p_post_id uuid,p_locale public.content_locale default 'ko')
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'celebritySlug',c.slug,'body',p.body,'visibility',p.visibility,'revision',p.revision,
    'createdAt',p.created_at,'updatedAt',p.updated_at,'isOwner',coalesce(p.app_user_id=p_app_user_id,false),
    'author',jsonb_build_object('nickname',coalesce(nullif(btrim(pr.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end),
      'avatarUrl','/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'width',x.width,'height',x.height) order by x.position) from public.content_assets x where x.post_id=p.id and x.deleted_at is null and x.cleanup_requested_at is null and x.uploaded_at is not null),'[]'::jsonb),
    'likeCount',(select count(*) from public.fan_post_likes k join public.app_users u on u.id=k.app_user_id and u.status='active' where k.post_id=p.id and not public.fan_web_blocked(p_app_user_id,k.app_user_id)),
    'liked',exists(select 1 from public.fan_post_likes where post_id=p.id and app_user_id=p_app_user_id),
    'commentCount',(select count(*) from public.fan_post_comments x where x.post_id=p.id and public.fan_web_content_visible(p_app_user_id,'fan_post_comment',x.id)))
  from public.fan_posts p join public.celebrities c on c.id=p.celebrity_id
  left join public.user_profiles pr on pr.app_user_id=p.app_user_id left join public.app_user_avatars a on a.app_user_id=p.app_user_id
  where p.id=p_post_id and public.fan_web_content_visible(p_app_user_id,'fan_post',p.id);
$$;
create function public.read_fan_post(p_app_user_id uuid,p_post_id uuid,p_locale public.content_locale default 'ko')
returns jsonb language sql stable security definer set search_path='' as $$
  select case when data is null then null else jsonb_build_object('post',data) end from (select public.fan_web_post_json(p_app_user_id,p_post_id,p_locale) data) x;
$$;
create function public.read_fan_posts(p_app_user_id uuid,p_slug text,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20,p_locale public.content_locale default 'ko')
returns jsonb language sql stable security definer set search_path='' as $$
  with creator as(select id from public.celebrities where slug=p_slug and status='published' and archived_at is null),
  candidates as materialized(select p.id,p.created_at from public.fan_posts p join creator c on c.id=p.celebrity_id
    where public.fan_web_content_visible(p_app_user_id,'fan_post',p.id) and (p_before is null or (p.created_at,p.id)<(p_before,p_before_id))
    order by p.created_at desc,p.id desc limit least(greatest(p_limit,1),50)+1),
  page as(select * from candidates order by created_at desc,id desc limit least(greatest(p_limit,1),50))
  select jsonb_build_object('items',coalesce((select jsonb_agg(public.fan_web_post_json(p_app_user_id,id,p_locale) order by created_at desc,id desc) from page),'[]'::jsonb),
    'hasMore',(select count(*)>least(greatest(p_limit,1),50) from candidates)) from creator;
$$;

create function public.save_fan_post(p_app_user_id uuid,p_slug text,p_post_id uuid,p_body text,p_visibility text,p_asset_ids uuid[],p_expected_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_creator uuid; v_post public.fan_posts%rowtype; v_id uuid; v_hash text; v_body text:=btrim(coalesce(p_body,'')); v_assets uuid[]:=coalesce(p_asset_ids,'{}'::uuid[]);
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_visibility is null or p_visibility not in ('public','members') or length(v_body)>5000 or cardinality(v_assets)>4
    or cardinality(v_assets)<>(select count(distinct x) from unnest(v_assets) x) or (v_body='' and cardinality(v_assets)=0) then
    raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  select id into v_creator from public.celebrities where slug=p_slug and status='published' and archived_at is null for share;
  if v_creator is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if p_visibility='members' and not public.fan_web_is_member(p_app_user_id,v_creator) then raise exception 'FAN_WEB_FORBIDDEN' using errcode='42501'; end if;
  v_hash:=encode(extensions.digest(jsonb_build_array(v_creator,v_body,p_visibility,v_assets)::text,'sha256'),'hex');
  if p_post_id is null then
    if p_idempotency_key is null then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
    select * into v_post from public.fan_posts where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
    if found then
      if v_post.create_request_hash<>v_hash then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
      return jsonb_build_object('id',v_post.id,'revision',v_post.revision,'replayed',true);
    end if;
    if (select count(*) from public.fan_posts where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
    v_id:=extensions.gen_random_uuid();
  else
    select * into v_post from public.fan_posts where id=p_post_id and app_user_id=p_app_user_id and celebrity_id=v_creator for update;
    if not found or v_post.deleted_at is not null or v_post.hidden_at is not null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
    if p_expected_revision is null or v_post.revision<>p_expected_revision then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
    if (select count(*) from public.content_write_events where app_user_id=p_app_user_id and kind='post_edit' and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
    v_id:=p_post_id;
  end if;
  perform 1 from public.content_assets where id=any(v_assets) order by id for update;
  if (select count(*) from public.content_assets where id=any(v_assets) and app_user_id=p_app_user_id and celebrity_id=v_creator
    and uploaded_at is not null and deleted_at is null and cleanup_requested_at is null and notice_id is null
    and (post_id=v_id or (post_id is null and expires_at>clock_timestamp())))<>cardinality(v_assets) then
    raise exception 'FAN_WEB_INVALID_ASSET' using errcode='22023'; end if;
  if p_post_id is null then
    insert into public.fan_posts(id,celebrity_id,app_user_id,body,visibility,idempotency_key,create_request_hash)
    values(v_id,v_creator,p_app_user_id,v_body,p_visibility,p_idempotency_key,v_hash) returning * into v_post;
  else
    update public.fan_posts set body=v_body,visibility=p_visibility,revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_post;
    insert into public.content_write_events(app_user_id,kind) values(p_app_user_id,'post_edit');
  end if;
  update public.content_assets set deleted_at=clock_timestamp(),cleanup_requested_at=clock_timestamp(),cleanup_retry_at=clock_timestamp(),position=null
    where post_id=v_id and deleted_at is null and not(id=any(v_assets));
  -- Clear old positions before assigning the new order to avoid transient unique conflicts.
  update public.content_assets set position=null where post_id=v_id and id=any(v_assets);
  update public.content_assets a set post_id=v_id,position=(s.ord-1)::smallint from unnest(v_assets) with ordinality s(id,ord) where a.id=s.id;
  return jsonb_build_object('id',v_id,'revision',v_post.revision,'replayed',false);
end $$;

create function public.remove_fan_post(p_app_user_id uuid,p_post_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  perform 1 from public.fan_posts where id=p_post_id and app_user_id=p_app_user_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  update public.fan_posts set deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_post_id and deleted_at is null;
  update public.content_assets set deleted_at=coalesce(deleted_at,clock_timestamp()),cleanup_requested_at=coalesce(cleanup_requested_at,clock_timestamp()),cleanup_retry_at=clock_timestamp()
    where post_id=p_post_id and storage_deleted_at is null;
end $$;

create function public.read_fan_post_comments(p_app_user_id uuid,p_post_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20,p_locale public.content_locale default 'ko')
returns jsonb language sql stable security definer set search_path='' as $$
  with candidates as materialized(select x.* from public.fan_post_comments x where x.post_id=p_post_id
    and public.fan_web_content_visible(p_app_user_id,'fan_post_comment',x.id) and (p_before is null or (x.created_at,x.id)<(p_before,p_before_id))
    order by x.created_at desc,x.id desc limit least(greatest(p_limit,1),50)+1),
  page as(select * from candidates order by created_at desc,id desc limit least(greatest(p_limit,1),50))
  select case when not public.fan_web_content_visible(p_app_user_id,'fan_post',p_post_id) then null else jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'postId',x.post_id,'parentId',x.parent_id,'body',x.body,'revision',x.revision,
      'createdAt',x.created_at,'isOwner',coalesce(x.app_user_id=p_app_user_id,false),
      'author',jsonb_build_object('nickname',coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end),
        'avatarUrl','/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp')) order by x.created_at desc,x.id desc)
      from page x left join public.user_profiles p on p.app_user_id=x.app_user_id left join public.app_user_avatars a on a.app_user_id=x.app_user_id),'[]'::jsonb),
    'hasMore',(select count(*)>least(greatest(p_limit,1),50) from candidates)) end;
$$;
create function public.post_fan_post_comment(p_app_user_id uuid,p_post_id uuid,p_parent_id uuid,p_body text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.fan_post_comments%rowtype; v_id uuid; v_body text:=btrim(p_body);
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_idempotency_key is null or v_body is null or length(v_body) not between 1 and 1000 then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  perform 1 from public.fan_posts where id=p_post_id for share;
  if not public.fan_web_content_visible(p_app_user_id,'fan_post',p_post_id) then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_existing from public.fan_post_comments where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.post_id<>p_post_id or v_existing.parent_id is distinct from p_parent_id or v_existing.body<>v_body then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('id',v_existing.id,'revision',v_existing.revision,'replayed',true);
  end if;
  if p_parent_id is not null then
    perform 1 from public.fan_post_comments where id=p_parent_id and post_id=p_post_id and parent_id is null for share;
    if not found or not public.fan_web_content_visible(p_app_user_id,'fan_post_comment',p_parent_id) then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  if (select count(*) from public.fan_post_comments where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
  insert into public.fan_post_comments(post_id,parent_id,app_user_id,body,idempotency_key) values(p_post_id,p_parent_id,p_app_user_id,v_body,p_idempotency_key) returning id into v_id;
  return jsonb_build_object('id',v_id,'revision',1,'replayed',false);
end $$;
create function public.remove_fan_post_comment(p_app_user_id uuid,p_comment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  perform 1 from public.fan_post_comments where id=p_comment_id and app_user_id=p_app_user_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  update public.fan_post_comments set deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_comment_id and deleted_at is null;
end $$;
create function public.set_fan_post_like(p_app_user_id uuid,p_post_id uuid,p_liked boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_liked is null then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  perform 1 from public.fan_posts where id=p_post_id for share;
  if not public.fan_web_content_visible(p_app_user_id,'fan_post',p_post_id) then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.fan_post_likes where post_id=p_post_id and app_user_id=p_app_user_id)=p_liked then return; end if;
  if (select count(*) from public.content_write_events where app_user_id=p_app_user_id and kind='like' and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
  if p_liked then insert into public.fan_post_likes(post_id,app_user_id) values(p_post_id,p_app_user_id);
  else delete from public.fan_post_likes where post_id=p_post_id and app_user_id=p_app_user_id; end if;
  insert into public.content_write_events(app_user_id,kind) values(p_app_user_id,'like');
end $$;

create function public.reserve_content_asset(p_app_user_id uuid,p_slug text,p_byte_size integer,p_width integer,p_height integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_creator uuid; v_id uuid:=extensions.gen_random_uuid(); v_path text;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select id into v_creator from public.celebrities where slug=p_slug and status='published' and archived_at is null;
  if v_creator is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if (select count(*) from public.content_assets where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
  v_path:=p_app_user_id::text||'/'||v_id::text||'.webp';
  insert into public.content_assets(id,app_user_id,celebrity_id,storage_path,byte_size,width,height,sha256)
    values(v_id,p_app_user_id,v_creator,v_path,p_byte_size,p_width,p_height,p_sha256);
  return jsonb_build_object('id',v_id,'storagePath',v_path);
end $$;
create function public.reserve_admin_content_asset(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_celebrity_id uuid,p_byte_size integer,p_width integer,p_height integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=extensions.gen_random_uuid(); v_path text;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if not exists(select 1 from public.celebrities where id=p_celebrity_id and archived_at is null) then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if (select count(*) from public.content_assets where app_user_id=p_actor_app_user_id and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
  v_path:=p_actor_app_user_id::text||'/'||v_id::text||'.webp';
  insert into public.content_assets(id,app_user_id,celebrity_id,storage_path,byte_size,width,height,sha256)
    values(v_id,p_actor_app_user_id,p_celebrity_id,v_path,p_byte_size,p_width,p_height,p_sha256);
  return jsonb_build_object('id',v_id,'storagePath',v_path);
end $$;
revoke all on function public.reserve_admin_content_asset(uuid,uuid,uuid,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_admin_content_asset(uuid,uuid,uuid,integer,integer,integer,text) to service_role;

create function public.finish_content_asset_upload(p_app_user_id uuid,p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  update public.content_assets set uploaded_at=coalesce(uploaded_at,clock_timestamp()),upload_settled_at=clock_timestamp()
    where id=p_asset_id and app_user_id=p_app_user_id and deleted_at is null and cleanup_requested_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
end $$;
create function public.read_content_asset(p_app_user_id uuid,p_asset_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('storagePath',a.storage_path,'mimeType',a.mime_type)
  from public.content_assets a where a.id=p_asset_id and a.uploaded_at is not null and a.deleted_at is null and a.cleanup_requested_at is null and a.storage_deleted_at is null
    and exists(select 1 from public.app_users u where u.id=a.app_user_id and u.status='active')
    and ((a.post_id is not null and public.fan_web_content_visible(p_app_user_id,'fan_post',a.post_id))
      or(a.notice_id is not null and public.fan_web_content_visible(p_app_user_id,'notice',a.notice_id))
      or(a.post_id is null and a.notice_id is null and a.app_user_id=p_app_user_id and a.expires_at>clock_timestamp()));
$$;
create function public.read_admin_content_asset(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object('storagePath',storage_path,'mimeType',mime_type) into v_result from public.content_assets
    where id=p_asset_id and uploaded_at is not null and deleted_at is null and cleanup_requested_at is null and storage_deleted_at is null;
  return v_result;
end $$;
create function public.claim_content_asset_cleanup(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  with due as(select a.id from public.content_assets a
    where a.storage_deleted_at is null and (a.cleanup_retry_at is null or a.cleanup_retry_at<=clock_timestamp())
      and (a.upload_settled_at is not null or a.upload_expires_at<=clock_timestamp())
      and (a.cleanup_requested_at is not null or a.deleted_at is not null or (a.post_id is null and a.notice_id is null and a.expires_at<=clock_timestamp())
        or exists(select 1 from public.app_users u where u.id=a.app_user_id and u.status<>'active'))
    order by coalesce(a.cleanup_retry_at,a.expires_at),a.id limit least(greatest(p_limit,1),100) for update skip locked),
  claimed as(update public.content_assets a set upload_settled_at=coalesce(upload_settled_at,clock_timestamp()),cleanup_requested_at=coalesce(cleanup_requested_at,clock_timestamp()),cleanup_retry_at=clock_timestamp()+interval '5 minutes',cleanup_generation=cleanup_generation+1
    from due where a.id=due.id returning a.id,a.storage_path,a.cleanup_generation)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket','fan-content-assets','storagePath',storage_path,'generation',cleanup_generation)),'[]'::jsonb)) into v_result from claimed;
  return v_result;
end $$;
create function public.finish_content_asset_cleanup(p_asset_id uuid,p_generation bigint,p_succeeded boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.content_assets set storage_deleted_at=case when p_succeeded then coalesce(storage_deleted_at,clock_timestamp()) else storage_deleted_at end,
    cleanup_retry_at=clock_timestamp()+interval '5 minutes'
    where id=p_asset_id and cleanup_requested_at is not null and cleanup_generation=p_generation;
end $$;

-- A storage upload can finish after deletion's cleanup pass. Requeue it durably.
create function public.abandon_content_asset_upload(p_app_user_id uuid,p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||p_app_user_id::text,0));
  update public.content_assets set upload_settled_at=clock_timestamp(),cleanup_requested_at=clock_timestamp(),cleanup_retry_at=clock_timestamp(),storage_deleted_at=null,deleted_at=coalesce(deleted_at,clock_timestamp()),cleanup_generation=cleanup_generation+1
    where id=p_asset_id and app_user_id=p_app_user_id and post_id is null and notice_id is null;
end $$;

create function public.post_content_report(p_app_user_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target jsonb; v_existing public.content_reports%rowtype; v_id uuid;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  select * into v_existing from public.content_reports where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.target_type<>p_target_type or v_existing.target_id<>p_target_id or v_existing.reason<>btrim(p_reason) then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('id',v_existing.id,'status',v_existing.status,'replayed',true);
  end if;
  v_target:=public.fan_web_content_target(p_app_user_id,p_target_type,p_target_id);
  if v_target is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_existing from public.content_reports where app_user_id=p_app_user_id and target_type=p_target_type and target_id=p_target_id and target_revision=(v_target->>'revision')::integer;
  if found then return jsonb_build_object('id',v_existing.id,'status',v_existing.status,'replayed',true); end if;
  if (select count(*) from public.content_reports where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FAN_WEB_RATE_LIMITED'; end if;
  insert into public.content_reports(app_user_id,celebrity_id,target_type,target_id,target_revision,target_app_user_id,reason,idempotency_key)
    values(p_app_user_id,(v_target->>'celebrityId')::uuid,p_target_type,p_target_id,(v_target->>'revision')::integer,(v_target->>'appUserId')::uuid,btrim(p_reason),p_idempotency_key) returning id into v_id;
  return jsonb_build_object('id',v_id,'status','open','replayed',false);
end $$;
create function public.block_content_author(p_app_user_id uuid,p_target_type text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target jsonb; v_owner uuid; v_id uuid;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  v_target:=public.fan_web_content_target(p_app_user_id,p_target_type,p_target_id);
  if v_target is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  v_owner:=(v_target->>'appUserId')::uuid;
  if v_owner is null or v_owner=p_app_user_id then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  insert into public.user_blocks(app_user_id,blocked_app_user_id) values(p_app_user_id,v_owner)
    on conflict(app_user_id,blocked_app_user_id) do update set app_user_id=excluded.app_user_id returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;
create function public.read_content_blocks(p_app_user_id uuid,p_locale public.content_locale default 'ko')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',b.id,'createdAt',b.created_at,
    'nickname',case when u.status='active' then coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) else case when p_locale='ko' then '삭제된 계정' else 'Deleted account' end end,
    'avatarUrl','/images/avatars/'||case when u.status='active' then coalesce(a.selected_character_id,'star-pink') else 'star-pink' end||'.webp') order by b.created_at desc),'[]'::jsonb)) into v_result
  from public.user_blocks b join public.app_users u on u.id=b.blocked_app_user_id left join public.user_profiles p on p.app_user_id=u.id left join public.app_user_avatars a on a.app_user_id=u.id where b.app_user_id=p_app_user_id;
  return v_result;
end $$;
create function public.remove_content_block(p_app_user_id uuid,p_block_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  delete from public.user_blocks where id=p_block_id and app_user_id=p_app_user_id;
end $$;

create function public.read_admin_content_reports(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_status text default 'open',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_status not in ('open','resolved','dismissed') then raise exception 'FAN_WEB_INVALID_INPUT'; end if;
  with candidates as materialized(select r.* from public.content_reports r where r.status=p_status and (p_before is null or(r.created_at,r.id)<(p_before,p_before_id))
    order by r.created_at desc,r.id desc limit least(greatest(p_limit,1),50)+1),
  page as(select * from candidates order by created_at desc,id desc limit least(greatest(p_limit,1),50))
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'targetType',r.target_type,'targetId',r.target_id,'targetRevision',r.target_revision,
    'reason',r.reason,'status',r.status,'createdAt',r.created_at,'target',jsonb_build_object('celebritySlug',c.slug,'body',case r.target_type
      when 'fan_post' then(select body from public.fan_posts where id=r.target_id and deleted_at is null)
      when 'fan_post_comment' then(select body from public.fan_post_comments where id=r.target_id and deleted_at is null)
      when 'notice' then(select l.title from public.celebrity_notice_localizations l where l.notice_id=r.target_id and l.locale='ko')
      when 'notice_comment' then(select body from public.celebrity_notice_comments where id=r.target_id)
      when 'cheer' then(select body from public.fan_lounge_messages where id=r.target_id)
      when 'live_submission' then(select body from public.live_fan_submissions where id=r.target_id and deleted_at is null) end)) order by r.created_at desc,r.id desc)
    from page r join public.celebrities c on c.id=r.celebrity_id),'[]'::jsonb),'hasMore',(select count(*)>least(greatest(p_limit,1),50) from candidates)) into v_result;
  return v_result;
end $$;
create function public.resolve_admin_content_report(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_report_id uuid,p_resolution text,p_hide_target boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.content_reports%rowtype; v_revision integer;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_resolution is null or p_resolution not in ('resolved','dismissed') or p_hide_target is null or (p_resolution='dismissed' and p_hide_target)
    or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  select * into v_report from public.content_reports where id=p_report_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if v_report.status<>'open' then
    if v_report.status<>p_resolution or v_report.target_hidden<>p_hide_target or v_report.resolution_reason<>btrim(p_reason) then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('id',v_report.id,'status',v_report.status,'targetHidden',v_report.target_hidden);
  end if;
  if p_hide_target then
    if v_report.target_type='fan_post' then
      update public.fan_posts set hidden_at=clock_timestamp(),hidden_by_admin_id=p_actor_admin_allowlist_id,hide_reason=btrim(p_reason),revision=revision+1,updated_at=clock_timestamp() where id=v_report.target_id and hidden_at is null;
    elsif v_report.target_type='fan_post_comment' then
      update public.fan_post_comments set hidden_at=clock_timestamp(),hidden_by_admin_id=p_actor_admin_allowlist_id,hide_reason=btrim(p_reason),revision=revision+1,updated_at=clock_timestamp() where id=v_report.target_id and hidden_at is null;
    elsif v_report.target_type='notice' then
      select revision into v_revision from public.celebrity_notices where id=v_report.target_id and archived_at is null for update;
      if found then perform public.set_admin_celebrity_notice_state(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,v_report.target_id,v_revision,'archive',btrim(p_reason)); end if;
    elsif v_report.target_type='notice_comment' then perform public.hide_admin_notice_comment(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,v_report.target_id,btrim(p_reason));
    elsif v_report.target_type='cheer' then perform public.hide_admin_lounge_message(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,v_report.target_id,btrim(p_reason));
    elsif v_report.target_type='live_submission' then perform public.fan_web_hide_live_submission(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,v_report.target_id,btrim(p_reason));
    end if;
  end if;
  update public.content_reports set status=p_resolution,resolved_at=clock_timestamp(),resolved_by_admin_id=p_actor_admin_allowlist_id,resolution_reason=btrim(p_reason),target_hidden=p_hide_target where id=p_report_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'content.report.resolve','content_report',p_report_id::text,p_correlation_id,jsonb_build_object('status',p_resolution,'targetType',v_report.target_type,'targetId',v_report.target_id,'hidden',p_hide_target));
  return jsonb_build_object('id',p_report_id,'status',p_resolution,'targetHidden',p_hide_target);
end $$;

create function public.read_content_translation(p_app_user_id uuid,p_target_type text,p_target_id uuid,p_target_locale text,p_locale public.content_locale default 'ko')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_target jsonb; v_result jsonb;
begin
  v_target:=public.fan_web_content_target(p_app_user_id,p_target_type,p_target_id,p_locale);
  if v_target is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  select jsonb_build_object('targetType',t.target_type,'targetId',t.target_id,'targetLocale',t.target_locale,'translatedText',t.translated_text,'sourceRevision',t.source_revision,'cached',true)
    into v_result from public.content_translations t where t.target_type=p_target_type and t.target_id=p_target_id and t.target_locale=p_target_locale
      and t.source_revision=(v_target->>'revision')::integer and t.source_hash=v_target->>'sourceHash' and t.source_locale=v_target->>'sourceLocale';
  return v_result;
end $$;
create function public.reserve_content_translation_request(p_app_user_id uuid,p_character_count integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_day timestamptz; v_month timestamptz;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_character_count is null or p_character_count not between 1 and 20000 then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web:translation-budget',0));
  v_day:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  v_month:=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from public.content_translation_requests where app_user_id=p_app_user_id and created_at>v_now-interval '1 minute')>=10
    or (select coalesce(sum(character_count),0)+p_character_count from public.content_translation_requests where app_user_id=p_app_user_id and created_at>=v_day)>10000
    or (select coalesce(sum(character_count),0)+p_character_count from public.content_translation_requests where created_at>=v_day)>20000
    or (select coalesce(sum(character_count),0)+p_character_count from public.content_translation_requests where created_at>=v_month)>200000 then
    raise exception 'TRANSLATION_RATE_LIMITED';
  end if;
  insert into public.content_translation_requests(app_user_id,character_count) values(p_app_user_id,p_character_count);
end $$;
create function public.save_content_translation(p_app_user_id uuid,p_target_type text,p_target_id uuid,p_target_locale text,p_locale public.content_locale,p_source_revision integer,p_source_hash text,p_translated_text text,p_detected_source_locale text)
returns void language plpgsql security definer set search_path='' as $$
declare v_target jsonb;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  v_target:=public.fan_web_content_target(p_app_user_id,p_target_type,p_target_id,p_locale);
  if v_target is null then raise exception 'FAN_WEB_NOT_FOUND' using errcode='P0002'; end if;
  if (v_target->>'revision')::integer<>p_source_revision or v_target->>'sourceHash'<>p_source_hash then raise exception 'FAN_WEB_CONFLICT' using errcode='23514'; end if;
  if p_translated_text is null or length(btrim(p_translated_text)) not between 1 and 100000 then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  insert into public.content_translations(target_type,target_id,source_revision,source_hash,source_locale,target_locale,source_app_user_id,celebrity_id,translated_text,detected_source_locale)
    values(p_target_type,p_target_id,p_source_revision,p_source_hash,v_target->>'sourceLocale',p_target_locale,(v_target->>'appUserId')::uuid,(v_target->>'celebrityId')::uuid,p_translated_text,p_detected_source_locale)
    on conflict(target_type,target_id,source_revision,source_hash,source_locale,target_locale) do nothing;
end $$;

create function public.read_fan_notices(p_app_user_id uuid,p_slug text,p_locale public.content_locale default 'ko',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20,p_before_pinned boolean default null)
returns jsonb language sql stable security definer set search_path='' as $$
  with page as materialized(select n.*,l.title from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    join public.celebrity_notice_localizations l on l.notice_id=n.id and l.locale=p_locale
    where c.slug=p_slug and public.fan_web_content_target(p_app_user_id,'notice',n.id,p_locale) is not null
      and (p_before is null or (n.pinned,n.published_at,n.id)<(p_before_pinned,p_before,p_before_id))
    order by n.pinned desc,n.published_at desc,n.id desc limit least(greatest(p_limit,1),50)+1),
  shown as(select * from page order by pinned desc,published_at desc,id desc limit least(greatest(p_limit,1),50))
  select jsonb_build_object('notices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'title',title,'pinned',pinned,'kind',notice_kind,
    'postType',post_type,'visibility',visibility,'revision',revision,'publishedAt',published_at) order by pinned desc,published_at desc,id desc) from shown),'[]'::jsonb),
    'hasMore',(select count(*)>least(greatest(p_limit,1),50) from page));
$$;
create function public.read_fan_notice(p_app_user_id uuid,p_slug text,p_notice_slug text,p_locale public.content_locale default 'ko')
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',n.id,'slug',n.slug,'title',l.title,'body',l.body_json,'pinned',n.pinned,'kind',n.notice_kind,
    'postType',n.post_type,'visibility',n.visibility,'revision',n.revision,'publishedAt',n.published_at)
  from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
  join public.celebrity_notice_localizations l on l.notice_id=n.id and l.locale=p_locale
  where c.slug=p_slug and n.slug=p_notice_slug and public.fan_web_content_target(p_app_user_id,'notice',n.id,p_locale) is not null;
$$;

alter function public.save_admin_celebrity_notice(uuid,uuid,uuid,uuid,integer,uuid,text,boolean,text,jsonb,text,jsonb) rename to fan_web_save_notice_base;
alter function public.set_admin_celebrity_notice_state(uuid,uuid,uuid,uuid,integer,text,text) rename to fan_web_notice_state_base;
create function public.set_admin_celebrity_notice_state(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_notice_id uuid,p_expected_revision integer,p_action text,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.fan_web_notice_state_base(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_notice_id,p_expected_revision,p_action,p_reason);
end $$;
revoke all on function public.fan_web_notice_state_base(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.set_admin_celebrity_notice_state(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.set_admin_celebrity_notice_state(uuid,uuid,uuid,uuid,integer,text,text) to service_role;

create function public.save_admin_celebrity_notice(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_notice_id uuid,p_expected_revision integer,p_celebrity_id uuid,p_slug text,p_pinned boolean,p_title_ko text,p_body_ko jsonb,p_title_en text,p_body_en jsonb,p_post_type text,p_visibility text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_asset_ids uuid[]; v_src text;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_post_type is null or p_post_type not in ('notice','artist_post') or p_visibility is null or p_visibility not in ('public','members') then raise exception 'FAN_WEB_INVALID_INPUT' using errcode='22023'; end if;
  v_asset_ids:='{}'::uuid[];
  for v_src in select value#>>'{}' from jsonb_path_query(jsonb_build_array(p_body_ko,p_body_en),'strict $.**.attrs.src') x(value) loop
    if v_src~'^/api/content-assets/[0-9a-fA-F-]{36}$' then v_asset_ids:=array_append(v_asset_ids,substring(v_src from '[0-9a-fA-F-]{36}$')::uuid);
    elsif p_visibility='members' then raise exception 'FAN_WEB_PRIVATE_ASSET_REQUIRED' using errcode='22023'; end if;
  end loop;
  select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_asset_ids from unnest(v_asset_ids) x;
  perform 1 from public.content_assets where id=any(v_asset_ids) order by id for update;
  if (select count(*) from public.content_assets where id=any(v_asset_ids) and celebrity_id=p_celebrity_id and uploaded_at is not null and deleted_at is null and cleanup_requested_at is null and post_id is null
    and (notice_id=p_notice_id or (notice_id is null and app_user_id=p_actor_app_user_id and expires_at>clock_timestamp())))<>cardinality(v_asset_ids) then raise exception 'FAN_WEB_INVALID_ASSET' using errcode='22023'; end if;
  v_id:=public.fan_web_save_notice_base(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_notice_id,p_expected_revision,p_celebrity_id,p_slug,p_pinned,p_title_ko,p_body_ko,p_title_en,p_body_en);
  update public.content_assets set deleted_at=clock_timestamp(),cleanup_requested_at=clock_timestamp(),cleanup_retry_at=clock_timestamp() where notice_id=v_id and deleted_at is null and not(id=any(v_asset_ids));
  update public.content_assets set notice_id=v_id where id=any(v_asset_ids);
  update public.celebrity_notices set post_type=p_post_type,visibility=p_visibility where id=v_id;
  return v_id;
end $$;
-- Existing internal callers retain their arity and the existing content classification.
create function public.save_admin_celebrity_notice(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_notice_id uuid,p_expected_revision integer,p_celebrity_id uuid,p_slug text,p_pinned boolean,p_title_ko text,p_body_ko jsonb,p_title_en text,p_body_en jsonb)
returns uuid language sql security definer set search_path='' as $$
  select public.save_admin_celebrity_notice(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_notice_id,p_expected_revision,p_celebrity_id,p_slug,p_pinned,p_title_ko,p_body_ko,p_title_en,p_body_en,
    coalesce((select post_type from public.celebrity_notices where id=p_notice_id),'notice'),coalesce((select visibility from public.celebrity_notices where id=p_notice_id),'public'));
$$;

-- Existing flat comments retain their reward triggers and gain the same ACL/fence.

create or replace function public.read_celebrity_notice_comments(
  p_slug text,p_notice_slug text,p_app_user_id uuid,p_before timestamptz,p_before_id uuid,p_limit integer,p_locale public.content_locale
) returns jsonb language sql stable security definer set search_path='' as $$
  with notice as (
    select n.id from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    where c.slug=p_slug and c.status='published' and c.archived_at is null and n.slug=p_notice_slug and n.publication_status='published' and n.archived_at is null and public.fan_web_content_target(p_app_user_id,'notice',n.id,p_locale) is not null
  ), visible as (
    select x.* from public.celebrity_notice_comments x join notice n on n.id=x.notice_id join public.app_users u on u.id=x.app_user_id and u.status='active' where x.removed_at is null and public.fan_web_content_target(p_app_user_id,'notice_comment',x.id,p_locale) is not null
  ), page as (
    select v.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from visible v left join public.user_profiles p on p.app_user_id=v.app_user_id left join public.app_user_avatars a on a.app_user_id=v.app_user_id
    where p_before is null or (v.created_at,v.id)<(p_before,p_before_id) order by v.created_at desc,v.id desc limit least(greatest(p_limit,1),50)
  )
  select jsonb_build_object('total',(select count(*) from visible),'comments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'body',body,'nickname',nickname,'avatarUrl',avatar_url,'createdAt',created_at,'isOwner',coalesce(app_user_id=p_app_user_id,false)) order by created_at desc,id desc) from page),'[]'::jsonb)) from notice;
$$;

create or replace function public.read_celebrity_notice_comments(p_slug text,p_notice_slug text,p_app_user_id uuid default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language sql stable security definer set search_path='' as $$
select public.read_celebrity_notice_comments(p_slug,p_notice_slug,p_app_user_id,p_before,p_before_id,p_limit,'ko'::public.content_locale);
$$;

create or replace function public.read_celebrity_cheers(
  p_slug text,p_app_user_id uuid default null,p_before timestamptz default null,
  p_before_id uuid default null,p_limit integer default 6,
  p_locale public.content_locale default 'ko'
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
  ), visible as materialized (
    select m.*
    from public.fan_lounge_messages m
    join creator c on c.id=m.celebrity_id
    join public.app_users u on u.id=m.app_user_id and u.status='active'
    where m.reply_to_id is null and m.removed_at is null and public.fan_web_content_visible(p_app_user_id,'cheer',m.id)
  ), page as (
    select v.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from visible v
    left join public.user_profiles p on p.app_user_id=v.app_user_id
    left join public.app_user_avatars a on a.app_user_id=v.app_user_id
    where p_before is null or (v.created_at,v.id)<(p_before,p_before_id)
    order by v.created_at desc,v.id desc
    limit least(greatest(p_limit,1),21)
  )
  select jsonb_build_object(
    'total',(select count(*) from visible),
    'comments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'body',body,'nickname',nickname,'avatarUrl',avatar_url,
      'createdAt',created_at,'isOwner',coalesce(app_user_id=p_app_user_id,false)
    ) order by created_at desc,id desc) from page),'[]'::jsonb)
  ) from creator;
$$;

create or replace function public.post_celebrity_notice_comment(p_app_user_id uuid,p_slug text,p_notice_slug text,p_body text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_notice uuid;v_existing public.celebrity_notice_comments%rowtype;v_id uuid;v_body text:=btrim(p_body);
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501'; end if;
  if p_idempotency_key is null or v_body is null or length(v_body) not between 1 and 1000 then
    raise exception 'FANPAGE_INVALID_REQUEST' using errcode='22023'; end if;
  select n.id into v_notice from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    where c.slug=p_slug and c.status='published' and c.archived_at is null and n.slug=p_notice_slug
      and n.publication_status='published' and n.archived_at is null for share of n,c;
  if v_notice is null or not public.fan_web_content_visible(p_app_user_id,'notice',v_notice) then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanpage:comment:'||p_app_user_id::text,0));
  select * into v_existing from public.celebrity_notice_comments where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.notice_id<>v_notice or v_existing.body<>v_body then
      raise exception 'FANPAGE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('id',v_existing.id,'replayed',true);
  end if;
  if (select count(*) from public.celebrity_notice_comments where app_user_id=p_app_user_id and created_at>now()-interval '1 minute')>=5 then
    raise exception 'FANPAGE_RATE_LIMITED' using errcode='P0001'; end if;
  insert into public.celebrity_notice_comments(notice_id,app_user_id,body,idempotency_key)
    values(v_notice,p_app_user_id,v_body,p_idempotency_key) returning id into v_id;
  return jsonb_build_object('id',v_id,'replayed',false);
end $$;

create or replace function public.remove_owned_notice_comment(p_app_user_id uuid,p_comment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501'; end if;
  update public.celebrity_notice_comments set removed_at=coalesce(removed_at,now())
    where id=p_comment_id and app_user_id=p_app_user_id;
  if not found then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
end $$;

create or replace function public.post_celebrity_lounge_message(
  p_app_user_id uuid,p_slug text,p_body text,p_idempotency_key uuid,
  p_reply_to_id uuid default null,p_locale public.content_locale default 'ko'
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_creator_id uuid;
  v_body text:=btrim(p_body);
  v_existing public.fan_lounge_messages%rowtype;
  v_id uuid;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if not exists(select 1 from public.app_users u where u.id=p_app_user_id and u.status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501';
  end if;
  if p_idempotency_key is null or v_body is null or length(v_body) not between 1 and 1000 then
    raise exception 'FANPAGE_INVALID_REQUEST' using errcode='22023';
  end if;
  select c.id into v_creator_id
  from public.celebrities c
  join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
  where c.slug=p_slug and c.status='published' and c.archived_at is null
  for share of c;
  if v_creator_id is null then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-lounge:post:'||p_app_user_id::text,0));
  select * into v_existing
  from public.fan_lounge_messages m
  where m.app_user_id=p_app_user_id and m.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.celebrity_id<>v_creator_id or v_existing.body<>v_body
       or v_existing.reply_to_id is distinct from p_reply_to_id then
      raise exception 'FANPAGE_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    return jsonb_build_object('id',v_existing.id,'replayed',true);
  end if;

  if p_reply_to_id is not null and not exists(
    select 1 from public.fan_lounge_messages parent
    join public.app_users author on author.id=parent.app_user_id and author.status='active'
    where parent.id=p_reply_to_id and parent.celebrity_id=v_creator_id and parent.removed_at is null and not public.fan_web_blocked(p_app_user_id,parent.app_user_id)
  ) then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
  if (select count(*) from public.fan_lounge_messages m
      where m.app_user_id=p_app_user_id and m.created_at>now()-interval '1 minute')>=10 then
    raise exception 'FANPAGE_RATE_LIMITED' using errcode='P0001';
  end if;
  insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key,reply_to_id)
  values(v_creator_id,p_app_user_id,v_body,p_idempotency_key,p_reply_to_id)
  returning id into v_id;
  return jsonb_build_object('id',v_id,'replayed',false);
end $$;

create or replace function public.remove_owned_lounge_message(p_app_user_id uuid,p_message_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if not exists(select 1 from public.app_users u where u.id=p_app_user_id and u.status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501';
  end if;
  update public.fan_lounge_messages m set removed_at=coalesce(m.removed_at,now())
  from public.celebrities c
  where m.id=p_message_id and m.app_user_id=p_app_user_id and m.celebrity_id=c.id
    and c.status='published' and c.archived_at is null;
  if not found then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
end $$;

create or replace function public.set_lounge_message_reaction(
  p_app_user_id uuid,p_message_id uuid,p_emoji text,p_enabled boolean
) returns void language plpgsql security definer set search_path='' as $$
declare v_exists boolean;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if p_enabled is null or p_emoji is null or p_emoji not in ('❤️','👍','😂','🥹','🔥','👏') then
    raise exception 'FANPAGE_INVALID_REQUEST' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users u where u.id=p_app_user_id and u.status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.fan_lounge_messages m
    join public.celebrities c on c.id=m.celebrity_id and c.status='published' and c.archived_at is null
    join public.app_users author on author.id=m.app_user_id and author.status='active'
    where m.id=p_message_id and m.removed_at is null and not public.fan_web_blocked(p_app_user_id,m.app_user_id)
  ) then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-lounge:reaction:'||p_app_user_id::text,0));
  select exists(select 1 from public.fan_lounge_message_reactions r
    where r.message_id=p_message_id and r.app_user_id=p_app_user_id and r.emoji=p_emoji) into v_exists;
  if v_exists=p_enabled then return; end if;
  if (select count(*) from public.fan_lounge_reaction_mutation_events e
      where e.app_user_id=p_app_user_id and e.created_at>now()-interval '1 minute')>=30 then
    raise exception 'FANPAGE_RATE_LIMITED' using errcode='P0001';
  end if;
  if p_enabled then
    insert into public.fan_lounge_message_reactions(message_id,app_user_id,emoji)
    values(p_message_id,p_app_user_id,p_emoji);
  else
    delete from public.fan_lounge_message_reactions r
    where r.message_id=p_message_id and r.app_user_id=p_app_user_id and r.emoji=p_emoji;
  end if;
  insert into public.fan_lounge_reaction_mutation_events(app_user_id,message_id,emoji,enabled)
  values(p_app_user_id,p_message_id,p_emoji,p_enabled);
end $$;

create or replace function public.hide_admin_notice_comment(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_comment_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'FANPAGE_INVALID_REQUEST'; end if;
  update public.celebrity_notice_comments set removed_at=now(),removed_by_admin_id=p_actor_admin_allowlist_id,removal_reason=btrim(p_reason)
    where id=p_comment_id and removed_at is null;
  if found then
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'notice.comment.hide','notice_comment',p_comment_id::text,p_correlation_id,jsonb_build_object('reason',btrim(p_reason)));
  elsif not exists(select 1 from public.celebrity_notice_comments where id=p_comment_id) then
    raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002';
  end if;
end $$;

create or replace function public.hide_admin_lounge_message(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_message_id uuid,p_reason text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'FANPAGE_INVALID_REQUEST' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.fan_lounge_messages m
    join public.celebrities c on c.id=m.celebrity_id
    where m.id=p_message_id and c.status='published' and c.archived_at is null
  ) then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
  update public.fan_lounge_messages m
  set removed_at=now(),removed_by_admin_id=p_actor_admin_allowlist_id,removal_reason=btrim(p_reason)
  from public.celebrities c
  where m.id=p_message_id and m.removed_at is null and m.celebrity_id=c.id
    and c.status='published' and c.archived_at is null;
  if found then
    insert into public.audit_logs(
      actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary
    ) values(
      p_actor_app_user_id,p_actor_admin_allowlist_id,'lounge.message.hide','lounge_message',p_message_id::text,
      p_correlation_id,jsonb_build_object('reason',btrim(p_reason))
    );
  end if;
end $$;

create or replace function public.read_celebrity_lounge(
  p_slug text,
  p_app_user_id uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50,
  p_ids uuid[] default null,
  p_locale public.content_locale default 'ko'
) returns jsonb
language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
  ), visible as materialized (
    select m.*
    from public.fan_lounge_messages m
    join creator c on c.id=m.celebrity_id
    join public.app_users u on u.id=m.app_user_id and u.status='active'
    where m.removed_at is null and not public.fan_web_blocked(p_app_user_id,m.app_user_id) and not exists(select 1 from public.fan_lounge_messages parent_blocked where parent_blocked.id=m.reply_to_id and public.fan_web_blocked(p_app_user_id,parent_blocked.app_user_id))
  ), page as (
    select v.*
    from visible v
    where case
      when p_ids is not null then v.id=any(p_ids)
      else p_before is null or (v.created_at,v.id)<(p_before,p_before_id)
    end
    order by v.created_at desc,v.id desc
    limit case when p_ids is not null then 200 else least(greatest(p_limit,1),50) end
  ), display as (
    select p.id,p.body,p.app_user_id,p.reply_to_id,p.created_at,
      coalesce(nullif(btrim(up.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(ua.selected_character_id,'star-pink')||'.webp' avatar_url,
      case when p.reply_to_id is null then null else jsonb_build_object(
        'id',p.reply_to_id,
        'body',case when parent.removed_at is null and parent_user.status='active' then parent.body else null end,
        'nickname',case when parent.removed_at is null and parent_user.status='active'
          then coalesce(nullif(btrim(parent_profile.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end)
          else null end
      ) end reply_to,
      coalesce(reaction.rows,'[]'::jsonb) reactions
    from page p
    left join public.user_profiles up on up.app_user_id=p.app_user_id
    left join public.app_user_avatars ua on ua.app_user_id=p.app_user_id
    left join public.fan_lounge_messages parent on parent.id=p.reply_to_id
    left join public.app_users parent_user on parent_user.id=parent.app_user_id
    left join public.user_profiles parent_profile on parent_profile.app_user_id=parent.app_user_id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'emoji',grouped.emoji,
        'count',grouped.reaction_count,
        'reacted',grouped.reacted
      ) order by array_position(array['❤️','👍','😂','🥹','🔥','👏'],grouped.emoji)) rows
      from (
        select r.emoji,count(distinct r.app_user_id)::integer reaction_count,
          coalesce(bool_or(r.app_user_id=p_app_user_id),false) reacted
        from public.fan_lounge_message_reactions r
        join public.app_users reacting_user on reacting_user.id=r.app_user_id and reacting_user.status='active'
        where r.message_id=p.id and not public.fan_web_blocked(p_app_user_id,r.app_user_id)
        group by r.emoji
      ) grouped
    ) reaction on true
  )
  select jsonb_build_object(
    'likeCount',(select count(distinct r.app_user_id) from public.fan_reactions r
      join creator c on c.id=r.celebrity_id
      join public.app_users u on u.id=r.app_user_id and u.status='active'
      where r.business_status='completed'),
    'total',(select count(*) from visible),
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'body',d.body,'nickname',d.nickname,'avatarUrl',d.avatar_url,
      'createdAt',d.created_at,'isOwner',coalesce(d.app_user_id=p_app_user_id,false),
      'replyTo',d.reply_to,'reactions',d.reactions
    ) order by d.created_at desc,d.id desc) from display d),'[]'::jsonb)
  )
  from creator;
$$;

-- Keep all entry points private; the renamed base is callable only by its definer.
revoke all on function public.fan_web_save_notice_base(uuid,uuid,uuid,uuid,integer,uuid,text,boolean,text,jsonb,text,jsonb) from public,anon,authenticated,service_role;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['abandon_content_asset_upload','block_content_author','claim_content_asset_cleanup','fan_web_content_target','fan_web_content_visible','fan_web_post_json','finish_content_asset_cleanup','finish_content_asset_upload','hide_admin_lounge_message','hide_admin_notice_comment','post_celebrity_lounge_message','post_celebrity_notice_comment','post_content_report','post_fan_post_comment','read_admin_content_asset','read_admin_content_reports','read_celebrity_cheers','read_celebrity_lounge','read_celebrity_notice_comments','read_content_asset','read_content_blocks','read_content_translation','read_fan_notice','read_fan_notices','read_fan_post','read_fan_post_comments','read_fan_posts','remove_content_block','remove_fan_post','remove_fan_post_comment','remove_owned_lounge_message','remove_owned_notice_comment','reserve_content_asset','reserve_content_translation_request','resolve_admin_content_report','save_admin_celebrity_notice','save_content_translation','save_fan_post','set_fan_post_like','set_lounge_message_reaction']) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
