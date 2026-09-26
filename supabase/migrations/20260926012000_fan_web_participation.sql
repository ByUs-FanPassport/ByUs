-- Fan participation has no reward or external-delivery producers.
create function public.fan_web_https_url(p_url text) returns boolean
language sql immutable set search_path='' as $$
  select p_url is not null and length(p_url)<=2048 and p_url ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$'
    and p_url !~ '[[:cntrl:]]';
$$;

create function public.fan_web_social_profile_key(p_url text) returns text
language plpgsql immutable set search_path='' as $$
declare m text[];
begin
  m:=regexp_match(p_url,'^https://(www\.)?instagram\.com/([A-Za-z0-9_.]{1,30})/?$');
  if m is not null and lower(m[2]) not in ('p','reel','reels','stories','explore','accounts') then return 'instagram:'||lower(m[2]); end if;
  m:=regexp_match(p_url,'^https://(www\.)?tiktok\.com/@([A-Za-z0-9_.]{1,24})/?$');
  if m is not null then return 'tiktok:'||lower(m[2]); end if;
  m:=regexp_match(p_url,'^https://(www\.)?youtube\.com/@([A-Za-z0-9_.-]{3,30})/?$');
  if m is not null then return 'youtube:@'||lower(m[2]); end if;
  m:=regexp_match(p_url,'^https://(www\.)?youtube\.com/channel/(UC[A-Za-z0-9_-]{22})/?$');
  if m is not null then return 'youtube:channel:'||m[2]; end if;
  m:=regexp_match(p_url,'^https://chzzk\.naver\.com/([A-Fa-f0-9]{32})/?$');
  if m is not null then return 'chzzk:'||lower(m[1]); end if;
  return null;
end $$;

create function public.fan_web_time_zone(p_name text) returns boolean
language sql stable set search_path='' as $$ select exists(select 1 from pg_catalog.pg_timezone_names where name=p_name); $$;

create table public.celebrity_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  kind text not null check(kind in('broadcast','concert','birthday','event')),
  title_ko text not null check(length(btrim(title_ko)) between 1 and 160),
  title_en text not null check(length(btrim(title_en)) between 1 and 160),
  description_ko text not null default '' check(length(description_ko)<=4000),
  description_en text not null default '' check(length(description_en)<=4000),
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  time_zone text not null default 'Asia/Seoul' check(public.fan_web_time_zone(time_zone)),
  location text not null default '' check(length(location)<=300),
  participation_instructions text not null default '' check(length(participation_instructions)<=2000),
  official_source_url text not null check(public.fan_web_https_url(official_source_url)),
  status text not null default 'draft' check(status in('draft','published','cancelled')),
  revision integer not null default 1 check(revision>0), idempotency_key uuid not null unique,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create index celebrity_schedules_calendar_idx on public.celebrity_schedules(starts_at,id) where status in('published','cancelled');
create index celebrity_schedules_artist_idx on public.celebrity_schedules(celebrity_id,starts_at,id);
create table public.schedule_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  schedule_id uuid not null references public.celebrity_schedules(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(), unique(schedule_id,app_user_id)
);
create table public.schedule_suggestions (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  kind text not null check(kind in('broadcast','concert','birthday','event')),
  title text not null check(length(btrim(title)) between 1 and 160),
  description text not null default '' check(length(description)<=4000),
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  time_zone text not null default 'Asia/Seoul' check(public.fan_web_time_zone(time_zone)),
  location text not null default '' check(length(location)<=300),
  participation_instructions text not null default '' check(length(participation_instructions)<=2000),
  source_url text not null check(public.fan_web_https_url(source_url)), locale public.content_locale not null,
  status text not null default 'pending' check(status in('pending','approved','rejected')),
  schedule_id uuid references public.celebrity_schedules(id) on delete restrict,
  review_reason text check(review_reason is null or length(btrim(review_reason)) between 1 and 1000),
  reviewed_at timestamptz, reviewed_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete set null,
  revision integer not null default 1 check(revision>0), idempotency_key uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  unique(app_user_id,idempotency_key),
  check((status='pending' and schedule_id is null and reviewed_at is null and review_reason is null) or
    (status='approved' and schedule_id is not null and reviewed_at is not null) or
    (status='rejected' and schedule_id is null and reviewed_at is not null and review_reason is not null))
);
create index schedule_suggestions_owner_idx on public.schedule_suggestions(app_user_id,created_at desc,id desc);
create index schedule_suggestions_review_idx on public.schedule_suggestions(status,created_at desc,id desc);
create table public.live_fan_submission_settings (
  live_event_id uuid primary key references public.live_events(id) on delete cascade,
  accepting boolean not null default false, closes_at timestamptz,
  visibility text not null default 'public' check(visibility in('public','members')),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check(not accepting or closes_at is not null)
);
create table public.live_fan_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null check(kind in('question','cheer')), body text not null check(length(btrim(body)) between 1 and 1000),
  status text not null default 'submitted' check(status in('submitted','selected','hidden')),
  revision integer not null default 1 check(revision>0), selected_at timestamptz,
  selected_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete set null,
  deleted_at timestamptz, idempotency_key uuid not null,
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  unique(app_user_id,idempotency_key), check(status<>'selected' or selected_at is not null)
);
create unique index live_fan_submissions_active_idx on public.live_fan_submissions(app_user_id,live_event_id,kind) where deleted_at is null;
create index live_fan_submissions_selected_idx on public.live_fan_submissions(live_event_id,selected_at desc,id desc) where status='selected' and deleted_at is null;
create index live_fan_submissions_quota_idx on public.live_fan_submissions(app_user_id,created_at);
create table public.fanpage_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 120),
  official_social_url text not null check(length(official_social_url)<=2048),
  official_social_key text not null check(length(official_social_key)<=300),
  note text not null default '' check(length(note)<=2000), locale public.content_locale not null,
  status text not null default 'pending' check(status in('pending','approved','rejected')),
  celebrity_id uuid references public.celebrities(id) on delete restrict,
  review_reason text check(review_reason is null or length(btrim(review_reason)) between 1 and 1000),
  reviewed_at timestamptz, reviewed_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete set null,
  revision integer not null default 1 check(revision>0), idempotency_key uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  unique(app_user_id,idempotency_key),
  check(public.fan_web_social_profile_key(official_social_url) is not null and official_social_key=public.fan_web_social_profile_key(official_social_url)),
  check((status='pending' and celebrity_id is null and reviewed_at is null and review_reason is null) or
    (status='approved' and celebrity_id is not null and reviewed_at is not null) or
    (status='rejected' and celebrity_id is null and reviewed_at is not null and review_reason is not null))
);
create unique index fanpage_requests_pending_idx on public.fanpage_requests(app_user_id,official_social_key) where status='pending';
create index fanpage_requests_owner_idx on public.fanpage_requests(app_user_id,created_at desc,id desc);
create index fanpage_requests_review_idx on public.fanpage_requests(status,created_at desc,id desc);

create function public.fan_web_replay_url(p_provider public.social_platform,p_url text) returns boolean
language sql immutable set search_path='' as $$
  select public.fan_web_https_url(p_url) and case p_provider::text
    when 'youtube' then p_url ~ '^https://((www\.)?youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[A-Za-z0-9_-]{11}([?&][^[:space:]]*)?$'
    when 'instagram' then p_url ~ '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$'
    when 'tiktok' then p_url ~ '^https://(www\.)?tiktok\.com/@[A-Za-z0-9_.]+/video/[0-9]+/?$'
    when 'chzzk' then p_url ~ '^https://chzzk\.naver\.com/video/[0-9]+/?$' else false end;
$$;
alter table public.live_events add column replay_provider public.social_platform,
  add column replay_url text, add column replay_published boolean not null default false,
  add column replay_revision integer not null default 1 check(replay_revision>0),
  add constraint live_events_replay_pair check((replay_provider is null)=(replay_url is null)),
  add constraint live_events_replay_url check(replay_url is null or public.fan_web_replay_url(replay_provider,replay_url)),
  add constraint live_events_replay_published check(not replay_published or replay_url is not null);

create function public.fan_web_participation_audit(p_actor uuid,p_allowlist uuid,p_correlation uuid,p_action text,p_entity text,p_id uuid,p_before jsonb,p_after jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor,p_allowlist,p_action,p_entity,p_id::text,p_correlation,jsonb_build_object('before',p_before,'after',p_after));
$$;
create function public.fan_web_schedule_json(p_id uuid,p_user uuid,p_locale public.content_locale,p_admin boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'celebrityId',s.celebrity_id,'celebritySlug',c.slug,'kind',s.kind,
    'title',case when p_admin then jsonb_build_object('ko',s.title_ko,'en',s.title_en) else to_jsonb(case when p_locale='ko' then s.title_ko else s.title_en end) end,
    'description',case when p_admin then jsonb_build_object('ko',s.description_ko,'en',s.description_en) else to_jsonb(case when p_locale='ko' then s.description_ko else s.description_en end) end,
    'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',s.time_zone,'location',s.location,
    'participationInstructions',s.participation_instructions,'officialSourceUrl',s.official_source_url,'status',s.status,'revision',s.revision)
    ||case when p_admin then jsonb_build_object('createdAt',s.created_at,'updatedAt',s.updated_at)
    else jsonb_build_object('celebrityName',l.name,'subscribed',case when p_user is null then null else exists(select 1 from public.schedule_subscriptions x where x.schedule_id=s.id and x.app_user_id=p_user) end,'detailHref','/live/calendar/schedules/'||s.id::text) end
  from public.celebrity_schedules s join public.celebrities c on c.id=s.celebrity_id
  left join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
  where s.id=p_id and (p_admin or (s.status in('published','cancelled') and c.status='published' and c.archived_at is null and l.name is not null));
$$;
create function public.fan_web_suggestion_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'celebritySlug',case when c.status='published' and c.archived_at is null then c.slug else null end,
    'kind',s.kind,'title',s.title,'description',s.description,'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',s.time_zone,
    'location',s.location,'participationInstructions',s.participation_instructions,'sourceUrl',s.source_url,'locale',s.locale,
    'status',s.status,'revision',s.revision,'reviewReason',s.review_reason,'reviewedAt',s.reviewed_at,
    'scheduleId',s.schedule_id,'scheduleHref',case when public.fan_web_schedule_json(s.schedule_id,null,s.locale) is not null then '/live/calendar/schedules/'||s.schedule_id::text else null end,'createdAt',s.created_at)
  from public.schedule_suggestions s join public.celebrities c on c.id=s.celebrity_id where s.id=p_id;
$$;
create function public.fan_web_request_json(p_id uuid,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'name',r.name,'officialSocialUrl',r.official_social_url,'note',r.note,'locale',r.locale,
    'status',r.status,'revision',r.revision,'reviewReason',r.review_reason,'reviewedAt',r.reviewed_at,'createdAt',r.created_at,
    'artist',(select jsonb_build_object('slug',c.slug,'name',l.name,'imageUrl',c.image_url,'href','/'||c.slug)
      from public.celebrities c join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
      where c.id=r.celebrity_id and c.status='published' and c.archived_at is null))
  from public.fanpage_requests r where r.id=p_id;
$$;
create function public.fan_web_owned_submission_json(p_id uuid,p_show_body boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'kind',s.kind,'body',case when p_show_body then s.body else null end,'status',s.status,
    'revision',s.revision,'createdAt',s.created_at,'selectedAt',s.selected_at,'deletedAt',s.deleted_at)
  from public.live_fan_submissions s where s.id=p_id;
$$;
create function public.fan_web_live_settings_json(p_live uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('accepting',accepting,'closesAt',closes_at,'visibility',visibility,'revision',revision)
    from public.live_fan_submission_settings where live_event_id=p_live),jsonb_build_object('accepting',false,'closesAt',null,'visibility','public','revision',0));
$$;

create function public.fan_web_list_schedules(p_app_user_id uuid,p_locale public.content_locale,p_starts_at timestamptz,p_ends_at timestamptz,p_celebrity_slug text,p_after_at timestamptz,p_after_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_next jsonb; v_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
begin
  if p_starts_at is null or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '32 days' or (p_after_at is null)<>(p_after_id is null) then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  with rows as materialized(select s.*,row_number() over(order by s.starts_at,s.id) rn from public.celebrity_schedules s
    join public.celebrities c on c.id=s.celebrity_id where s.status in('published','cancelled') and c.status='published' and c.archived_at is null
      and exists(select 1 from public.celebrity_localizations l where l.celebrity_id=c.id and l.locale=p_locale)
      and s.starts_at>=p_starts_at and s.starts_at<p_ends_at and (p_celebrity_slug is null or c.slug=p_celebrity_slug)
      and (p_after_at is null or (s.starts_at,s.id)>(p_after_at,p_after_id)) order by s.starts_at,s.id limit v_limit+1)
  select coalesce(jsonb_agg(public.fan_web_schedule_json(id,p_app_user_id,p_locale) order by starts_at,id) filter(where rn<=v_limit),'[]'::jsonb),
    case when count(*)>v_limit then (select jsonb_build_object('at',starts_at,'id',id) from rows where rn=v_limit) end into v_items,v_next from rows;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $$;
create function public.fan_web_list_owned_schedule_suggestions(p_app_user_id uuid,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql stable security definer set search_path='' as $$
  with rows as materialized(select s.id,s.created_at,row_number() over(order by s.created_at desc,s.id desc) rn from public.schedule_suggestions s
    join public.app_users u on u.id=s.app_user_id and u.status='active'
    where s.app_user_id=p_app_user_id and (p_before_at is null or (s.created_at,s.id)<(p_before_at,p_before_id))
    order by s.created_at desc,s.id desc limit least(greatest(coalesce(p_limit,20),1),50)+1)
  select jsonb_build_object('items',coalesce(jsonb_agg(public.fan_web_suggestion_json(id) order by created_at desc,id desc) filter(where rn<=least(greatest(coalesce(p_limit,20),1),50)),'[]'::jsonb),
    'nextCursor',case when count(*)>least(greatest(coalesce(p_limit,20),1),50) then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=least(greatest(coalesce(p_limit,20),1),50)) end) from rows;
$$;
create function public.fan_web_list_owned_fanpage_requests(p_app_user_id uuid,p_locale public.content_locale,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql stable security definer set search_path='' as $$
  with rows as materialized(select r.id,r.created_at,row_number() over(order by r.created_at desc,r.id desc) rn from public.fanpage_requests r
    join public.app_users u on u.id=r.app_user_id and u.status='active'
    where r.app_user_id=p_app_user_id and (p_before_at is null or (r.created_at,r.id)<(p_before_at,p_before_id))
    order by r.created_at desc,r.id desc limit least(greatest(coalesce(p_limit,20),1),50)+1)
  select jsonb_build_object('items',coalesce(jsonb_agg(public.fan_web_request_json(id,p_locale) order by created_at desc,id desc) filter(where rn<=least(greatest(coalesce(p_limit,20),1),50)),'[]'::jsonb),
    'nextCursor',case when count(*)>least(greatest(coalesce(p_limit,20),1),50) then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=least(greatest(coalesce(p_limit,20),1),50)) end) from rows;
$$;
create function public.fan_web_submit_schedule_suggestion(p_app_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_creator uuid; v_hash text:=encode(extensions.digest((p_payload-'idempotencyKey')::text,'sha256'),'hex'); r public.schedule_suggestions%rowtype;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select * into r from public.schedule_suggestions where app_user_id=p_app_user_id and idempotency_key=(p_payload->>'idempotencyKey')::uuid;
  if found then
    if r.request_hash<>v_hash then raise exception 'FAN_WEB_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('item',public.fan_web_suggestion_json(r.id),'replayed',true);
  end if;
  if (select count(*) from public.schedule_suggestions where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '24 hours')>=5 then raise exception 'FAN_WEB_RATE_LIMIT'; end if;
  select id into v_creator from public.celebrities where slug=p_payload->>'celebritySlug' and status='published' and archived_at is null;
  if v_creator is null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  insert into public.schedule_suggestions(app_user_id,celebrity_id,kind,title,description,starts_at,ends_at,time_zone,location,participation_instructions,source_url,locale,idempotency_key,request_hash)
    values(p_app_user_id,v_creator,p_payload->>'kind',btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),(p_payload->>'startsAt')::timestamptz,(p_payload->>'endsAt')::timestamptz,p_payload->>'timeZone',coalesce(p_payload->>'location',''),coalesce(p_payload->>'participationInstructions',''),p_payload->>'sourceUrl',(p_payload->>'locale')::public.content_locale,(p_payload->>'idempotencyKey')::uuid,v_hash) returning id into v_id;
  return jsonb_build_object('item',public.fan_web_suggestion_json(v_id),'replayed',false);
end $$;
create function public.fan_web_check_fanpage_request(p_name text,p_official_social_url text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('artists',coalesce(jsonb_agg(item),'[]'::jsonb)) from (
    select jsonb_build_object('slug',c.slug,'name',l.name,'imageUrl',c.image_url,'href','/'||c.slug) item
    from public.celebrities c join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.status='published' and c.archived_at is null and (lower(btrim(l.name))=lower(btrim(p_name))
      or exists(select 1 from public.celebrity_social_links x where x.celebrity_id=c.id and public.fan_web_social_profile_key(x.url)=public.fan_web_social_profile_key(p_official_social_url)))
    order by c.display_order,c.id limit 5) matches;
$$;
create function public.fan_web_submit_fanpage_request(p_app_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_key text:=public.fan_web_social_profile_key(p_payload->>'officialSocialUrl');
  v_hash text:=encode(extensions.digest((p_payload-'idempotencyKey')::text,'sha256'),'hex'); r public.fanpage_requests%rowtype;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if v_key is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  select * into r from public.fanpage_requests where app_user_id=p_app_user_id and idempotency_key=(p_payload->>'idempotencyKey')::uuid;
  if found then
    if r.request_hash<>v_hash then raise exception 'FAN_WEB_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('item',public.fan_web_request_json(r.id,(p_payload->>'locale')::public.content_locale),'replayed',true);
  end if;
  select * into r from public.fanpage_requests where app_user_id=p_app_user_id and official_social_key=v_key and status='pending';
  if found then return jsonb_build_object('item',public.fan_web_request_json(r.id,(p_payload->>'locale')::public.content_locale),'replayed',true); end if;
  if (select count(*) from public.fanpage_requests where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '24 hours')>=5 then raise exception 'FAN_WEB_RATE_LIMIT'; end if;
  insert into public.fanpage_requests(app_user_id,name,official_social_url,official_social_key,note,locale,idempotency_key,request_hash)
    values(p_app_user_id,btrim(p_payload->>'name'),p_payload->>'officialSocialUrl',v_key,coalesce(p_payload->>'note',''),(p_payload->>'locale')::public.content_locale,(p_payload->>'idempotencyKey')::uuid,v_hash) returning id into v_id;
  return jsonb_build_object('item',public.fan_web_request_json(v_id,(p_payload->>'locale')::public.content_locale),'replayed',false);
end $$;

create function public.fan_web_admin_save_schedule(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_schedule_id uuid,p_expected_revision integer,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.celebrity_schedules%rowtype; v_id uuid; v_hash text:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_idempotency_key is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  if p_schedule_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-schedule:'||p_idempotency_key::text,0));
    select * into r from public.celebrity_schedules where idempotency_key=p_idempotency_key;
    if found then
      if r.request_hash<>v_hash then raise exception 'FAN_WEB_IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('item',public.fan_web_schedule_json(r.id,null,'ko',true),'replayed',true);
    end if;
    if p_expected_revision<>0 then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  else
    select * into r from public.celebrity_schedules where id=p_schedule_id for update;
    if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
    if r.revision<>p_expected_revision or r.status='cancelled' then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
    if r.celebrity_id<>(p_payload->>'celebrityId')::uuid or (r.status='published' and p_payload->>'status'='draft') then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  end if;
  if not exists(select 1 from public.celebrities where id=(p_payload->>'celebrityId')::uuid and archived_at is null) then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if p_schedule_id is null then
    insert into public.celebrity_schedules(celebrity_id,kind,title_ko,title_en,description_ko,description_en,starts_at,ends_at,time_zone,location,participation_instructions,official_source_url,status,idempotency_key,request_hash)
    values((p_payload->>'celebrityId')::uuid,p_payload->>'kind',btrim(p_payload#>>'{title,ko}'),btrim(p_payload#>>'{title,en}'),coalesce(p_payload#>>'{description,ko}',''),coalesce(p_payload#>>'{description,en}',''),(p_payload->>'startsAt')::timestamptz,(p_payload->>'endsAt')::timestamptz,p_payload->>'timeZone',coalesce(p_payload->>'location',''),coalesce(p_payload->>'participationInstructions',''),p_payload->>'officialSourceUrl',p_payload->>'status',p_idempotency_key,v_hash) returning id into v_id;
  else
    v_id:=r.id;
    if (public.fan_web_schedule_json(r.id,null,'ko',true)-array['id','celebritySlug','revision','createdAt','updatedAt'])=(p_payload||jsonb_build_object('startsAt',(p_payload->>'startsAt')::timestamptz,'endsAt',(p_payload->>'endsAt')::timestamptz)) then
      return jsonb_build_object('item',public.fan_web_schedule_json(r.id,null,'ko',true),'replayed',true);
    end if;
    update public.celebrity_schedules set kind=p_payload->>'kind',title_ko=btrim(p_payload#>>'{title,ko}'),title_en=btrim(p_payload#>>'{title,en}'),description_ko=coalesce(p_payload#>>'{description,ko}',''),description_en=coalesce(p_payload#>>'{description,en}',''),starts_at=(p_payload->>'startsAt')::timestamptz,ends_at=(p_payload->>'endsAt')::timestamptz,time_zone=p_payload->>'timeZone',location=coalesce(p_payload->>'location',''),participation_instructions=coalesce(p_payload->>'participationInstructions',''),official_source_url=p_payload->>'officialSourceUrl',status=p_payload->>'status',revision=revision+1,updated_at=clock_timestamp() where id=v_id;
  end if;
  perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'schedule.saved','celebrity_schedule',v_id,jsonb_build_object('revision',r.revision,'status',r.status),jsonb_build_object('revision',coalesce(r.revision,0)+1,'status',p_payload->>'status'));
  return jsonb_build_object('item',public.fan_web_schedule_json(v_id,null,'ko',true),'replayed',false);
end $$;

create function public.fan_web_admin_review_schedule_suggestion(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_suggestion_id uuid,p_expected_revision integer,p_decision text,p_reason text,p_schedule jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.schedule_suggestions%rowtype; v_result jsonb; v_status text;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  v_status:=case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' end;
  if v_status is null or p_correlation_id is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  select * into r from public.schedule_suggestions where id=p_suggestion_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if r.status=v_status then return jsonb_build_object('item',public.fan_web_suggestion_json(r.id),'replayed',true); end if;
  if r.status<>'pending' or r.revision<>p_expected_revision then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  if v_status='approved' then
    if p_schedule is null or (p_schedule->>'celebrityId')::uuid<>r.celebrity_id or p_schedule->>'status'<>'published' then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
    v_result:=public.fan_web_admin_save_schedule(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,null,0,r.id,p_schedule);
  elsif nullif(btrim(p_reason),'') is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  update public.schedule_suggestions set status=v_status,schedule_id=(v_result#>>'{item,id}')::uuid,review_reason=nullif(btrim(p_reason),''),reviewed_at=clock_timestamp(),reviewed_by_admin_allowlist_id=p_actor_admin_allowlist_id,revision=revision+1,updated_at=clock_timestamp() where id=r.id;
  perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'schedule_suggestion.reviewed','schedule_suggestion',r.id,jsonb_build_object('status',r.status),jsonb_build_object('status',v_status));
  return jsonb_build_object('item',public.fan_web_suggestion_json(r.id),'replayed',false);
end $$;
create function public.fan_web_admin_review_fanpage_request(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_request_id uuid,p_expected_revision integer,p_decision text,p_reason text,p_celebrity_id uuid,p_locale public.content_locale)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fanpage_requests%rowtype; v_status text;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  v_status:=case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' end;
  if v_status is null or p_correlation_id is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  select * into r from public.fanpage_requests where id=p_request_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if r.status=v_status then return jsonb_build_object('item',public.fan_web_request_json(r.id,p_locale),'replayed',true); end if;
  if r.status<>'pending' or r.revision<>p_expected_revision then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  if v_status='approved' then
    if not exists(select 1 from public.celebrities where id=p_celebrity_id and archived_at is null) then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  elsif nullif(btrim(p_reason),'') is null or p_celebrity_id is not null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  update public.fanpage_requests set status=v_status,celebrity_id=p_celebrity_id,review_reason=nullif(btrim(p_reason),''),reviewed_at=clock_timestamp(),reviewed_by_admin_allowlist_id=p_actor_admin_allowlist_id,revision=revision+1,updated_at=clock_timestamp() where id=r.id;
  perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'fanpage_request.reviewed','fanpage_request',r.id,jsonb_build_object('status',r.status),jsonb_build_object('status',v_status));
  return jsonb_build_object('item',public.fan_web_request_json(r.id,p_locale),'replayed',false);
end $$;
create function public.fan_web_get_schedule(p_app_user_id uuid,p_schedule_id uuid,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$ select public.fan_web_schedule_json(p_schedule_id,p_app_user_id,p_locale); $$;
create function public.fan_web_set_schedule_subscription(p_app_user_id uuid,p_schedule_id uuid,p_subscribed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.celebrity_schedules%rowtype;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select * into s from public.celebrity_schedules where id=p_schedule_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if p_subscribed then
    if s.status<>'published' or s.starts_at<=clock_timestamp() or not exists(select 1 from public.celebrities where id=s.celebrity_id and status='published' and archived_at is null) then raise exception 'FAN_WEB_CLOSED'; end if;
    insert into public.schedule_subscriptions(schedule_id,app_user_id) values(s.id,p_app_user_id) on conflict(schedule_id,app_user_id) do nothing;
  else delete from public.schedule_subscriptions where schedule_id=s.id and app_user_id=p_app_user_id; end if;
  return jsonb_build_object('scheduleId',s.id,'subscribed',p_subscribed);
end $$;

create function public.fan_web_get_live_submission_target(p_app_user_id uuid,p_submission_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('targetType','live_submission','targetId',s.id,'celebrityId',l.celebrity_id,'appUserId',s.app_user_id,
    'body',s.body,'revision',s.revision,'visibility',coalesce(settings.visibility,'public'),'liveEventId',l.id,'liveSlug',l.slug,'createdAt',s.created_at)
  from public.live_fan_submissions s join public.live_events l on l.id=s.live_event_id
  join public.celebrities c on c.id=l.celebrity_id join public.app_users u on u.id=s.app_user_id and u.status='active'
  left join public.live_fan_submission_settings settings on settings.live_event_id=l.id
  where s.id=p_submission_id and s.deleted_at is null and s.status<>'hidden' and (s.status='selected' or s.app_user_id=p_app_user_id)
    and l.publication_status='published' and l.archived_at is null and c.status='published' and c.archived_at is null
    and (p_app_user_id is null or exists(select 1 from public.app_users viewer where viewer.id=p_app_user_id and viewer.status='active'))
    and (coalesce(settings.visibility,'public')='public' or public.fan_web_is_member(p_app_user_id,c.id))
    and not public.fan_web_blocked(p_app_user_id,s.app_user_id);
$$;
create function public.fan_web_list_live_submissions(p_app_user_id uuid,p_live_slug text,p_locale public.content_locale,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_live uuid; v_artist uuid; v_settings jsonb; v_access text; v_mine jsonb; v_items jsonb; v_next jsonb; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  select l.id,l.celebrity_id into v_live,v_artist from public.live_events l join public.celebrities c on c.id=l.celebrity_id
    where l.slug=p_live_slug and l.publication_status='published' and l.archived_at is null and c.status='published' and c.archived_at is null;
  if v_live is null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if p_app_user_id is not null and not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then raise exception 'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED'; end if;
  v_settings:=public.fan_web_live_settings_json(v_live);
  v_access:=case when v_settings->>'visibility'='public' then 'public' when public.fan_web_is_member(p_app_user_id,v_artist) then 'member' else 'members_required' end;
  select coalesce(jsonb_agg(public.fan_web_owned_submission_json(s.id,public.fan_web_get_live_submission_target(p_app_user_id,s.id) is not null) order by s.created_at,s.id),'[]'::jsonb) into v_mine
    from public.live_fan_submissions s where s.live_event_id=v_live and s.app_user_id=p_app_user_id and s.deleted_at is null;
  with rows as materialized(select s.*,row_number() over(order by s.selected_at desc,s.id desc) rn from public.live_fan_submissions s
    where s.live_event_id=v_live and s.status='selected' and s.deleted_at is null and public.fan_web_get_live_submission_target(p_app_user_id,s.id) is not null
      and (p_before_at is null or (s.selected_at,s.id)<(p_before_at,p_before_id)) order by s.selected_at desc,s.id desc limit v_limit+1)
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'body',r.body,'nickname',coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end),
    'avatarUrl','/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp','createdAt',r.created_at,'selectedAt',r.selected_at,'revision',r.revision,'isOwner',coalesce(r.app_user_id=p_app_user_id,false)) order by r.selected_at desc,r.id desc) filter(where r.rn<=v_limit),'[]'::jsonb),
    case when count(*)>v_limit then (select jsonb_build_object('at',selected_at,'id',id) from rows where rn=v_limit) end into v_items,v_next
    from rows r left join public.user_profiles p on p.app_user_id=r.app_user_id left join public.app_user_avatars a on a.app_user_id=r.app_user_id;
  return jsonb_build_object('settings',v_settings,'access',v_access,'mine',v_mine,'items',v_items,'nextCursor',v_next);
end $$;
create function public.fan_web_submit_live_submission(p_app_user_id uuid,p_live_slug text,p_kind text,p_body text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.live_fan_submissions%rowtype; settings public.live_fan_submission_settings%rowtype; v_live uuid; v_artist uuid; v_id uuid;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select l.id,l.celebrity_id into v_live,v_artist from public.live_events l join public.celebrities c on c.id=l.celebrity_id
    where l.slug=p_live_slug and l.publication_status='published' and l.archived_at is null and c.status='published' and c.archived_at is null;
  if v_live is null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  select * into settings from public.live_fan_submission_settings where live_event_id=v_live for update;
  -- The deadline is checked after the same row lock used by the admin-close path.
  if not found then raise exception 'FAN_WEB_CLOSED'; end if;
  select * into r from public.live_fan_submissions where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if r.live_event_id<>v_live or r.kind<>p_kind or r.body<>btrim(p_body) then raise exception 'FAN_WEB_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('item',public.fan_web_owned_submission_json(r.id,public.fan_web_get_live_submission_target(p_app_user_id,r.id) is not null),'replayed',true);
  end if;
  if not settings.accepting or settings.closes_at is null or clock_timestamp()>=settings.closes_at then raise exception 'FAN_WEB_CLOSED'; end if;
  if settings.visibility='members' and not public.fan_web_is_member(p_app_user_id,v_artist) then raise exception 'FAN_WEB_MEMBERS_REQUIRED'; end if;
  if exists(select 1 from public.live_fan_submissions where app_user_id=p_app_user_id and live_event_id=v_live and kind=p_kind and deleted_at is null) then raise exception 'FAN_WEB_ALREADY_SUBMITTED'; end if;
  if (select count(*) from public.live_fan_submissions where app_user_id=p_app_user_id and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception 'FAN_WEB_RATE_LIMIT'; end if;
  insert into public.live_fan_submissions(live_event_id,app_user_id,kind,body,idempotency_key) values(v_live,p_app_user_id,p_kind,btrim(p_body),p_idempotency_key) returning id into v_id;
  return jsonb_build_object('item',public.fan_web_owned_submission_json(v_id,true),'replayed',false);
end $$;
create function public.fan_web_delete_live_submission(p_app_user_id uuid,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.live_fan_submissions%rowtype;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  select * into r from public.live_fan_submissions where id=p_submission_id and app_user_id=p_app_user_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if r.deleted_at is null then update public.live_fan_submissions set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=r.id; end if;
  return jsonb_build_object('id',r.id,'deleted',true,'replayed',r.deleted_at is not null);
end $$;
create function public.fan_web_admin_save_live_submission_settings(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_live_event_id uuid,p_expected_revision integer,p_accepting boolean,p_closes_at timestamptz,p_visibility text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.live_fan_submission_settings%rowtype; v_created boolean;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  insert into public.live_fan_submission_settings(live_event_id) values(p_live_event_id) on conflict do nothing returning * into r;
  v_created:=found;
  select * into r from public.live_fan_submission_settings where live_event_id=p_live_event_id for update;
  if (v_created and p_expected_revision<>0) or (not v_created and r.revision<>p_expected_revision) then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  if p_accepting and (p_closes_at is null or p_closes_at<=clock_timestamp()) then raise exception 'FAN_WEB_CLOSED'; end if;
  update public.live_fan_submission_settings set accepting=p_accepting,closes_at=p_closes_at,visibility=p_visibility,revision=case when v_created then 1 else revision+1 end,updated_at=clock_timestamp() where live_event_id=p_live_event_id;
  perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'live_submission.settings','live_event',p_live_event_id,jsonb_build_object('revision',case when v_created then 0 else r.revision end),jsonb_build_object('accepting',p_accepting,'visibility',p_visibility));
  return public.fan_web_live_settings_json(p_live_event_id);
end $$;
create function public.fan_web_admin_review_live_submission(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_submission_id uuid,p_expected_revision integer,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.live_fan_submissions%rowtype; v_live uuid; v_status text;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_action not in('select','unselect','hide') or (p_action='hide' and nullif(btrim(p_reason),'') is null) or length(p_reason)>1000 then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  select live_event_id into v_live from public.live_fan_submissions where id=p_submission_id;
  perform 1 from public.live_fan_submission_settings where live_event_id=v_live for update;
  select * into r from public.live_fan_submissions where id=p_submission_id for update;
  if not found or r.deleted_at is not null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if r.revision<>p_expected_revision then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  if r.status='hidden' and p_action<>'hide' then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if p_action='select' and not exists(select 1 from public.live_events l join public.celebrities c on c.id=l.celebrity_id join public.app_users u on u.id=r.app_user_id and u.status='active' where l.id=r.live_event_id and l.publication_status='published' and l.archived_at is null and c.status='published' and c.archived_at is null) then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  v_status:=case p_action when 'select' then 'selected' when 'unselect' then 'submitted' else 'hidden' end;
  if r.status<>v_status then
    update public.live_fan_submissions set status=v_status,selected_at=case when p_action='select' then clock_timestamp() when p_action='unselect' then null else selected_at end,selected_by_admin_allowlist_id=case when p_action='select' then p_actor_admin_allowlist_id when p_action='unselect' then null else selected_by_admin_allowlist_id end,revision=revision+1,updated_at=clock_timestamp() where id=r.id;
    perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'live_submission.'||p_action,'live_submission',r.id,jsonb_build_object('status',r.status,'revision',r.revision),jsonb_build_object('status',v_status,'revision',r.revision+1));
  end if;
  return public.fan_web_owned_submission_json(r.id,true)||jsonb_build_object('nickname',coalesce((select nullif(btrim(nickname),'') from public.user_profiles where app_user_id=r.app_user_id),'팬'),'avatarUrl',coalesce((select '/images/avatars/'||selected_character_id||'.webp' from public.app_user_avatars where app_user_id=r.app_user_id),'/images/avatars/star-pink.webp'));
end $$;
create function public.fan_web_hide_live_submission(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_submission_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision integer; v_result jsonb;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select revision into v_revision from public.live_fan_submissions where id=p_submission_id;
  if v_revision is null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  v_result:=public.fan_web_admin_review_live_submission(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_submission_id,v_revision,'hide',p_reason);
  return jsonb_build_object('id',p_submission_id,'hidden',true,'revision',v_result->'revision');
end $$;
create function public.fan_web_admin_save_live_replay(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_live_event_id uuid,p_expected_revision integer,p_provider public.social_platform,p_url text,p_published boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.live_events%rowtype;
begin
  perform public.fan_web_lock_active_user(p_actor_app_user_id);
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into r from public.live_events where id=p_live_event_id for update;
  if not found then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  if r.replay_revision<>p_expected_revision then raise exception 'FAN_WEB_REVISION_CONFLICT'; end if;
  if p_correlation_id is null or (p_url is null)<>(p_provider is null) or (p_published and p_url is null) or (p_url is not null and not public.fan_web_replay_url(p_provider,p_url)) then raise exception 'FAN_WEB_INVALID_REQUEST'; end if;
  if (r.replay_provider,r.replay_url,r.replay_published) is distinct from (p_provider,p_url,p_published) then
    update public.live_events set replay_provider=p_provider,replay_url=p_url,replay_published=p_published,replay_revision=replay_revision+1 where id=r.id returning * into r;
    perform public.fan_web_participation_audit(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,'live.replay_saved','live_event',r.id,jsonb_build_object('revision',p_expected_revision),jsonb_build_object('revision',r.replay_revision,'published',p_published));
  end if;
  return jsonb_build_object('liveEventId',r.id,'replayProvider',r.replay_provider,'replayUrl',r.replay_url,'replayPublished',r.replay_published,'replayRevision',r.replay_revision);
end $$;

create function public.fan_web_admin_list_schedules(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_status text,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  with rows as materialized(select id,created_at,row_number() over(order by created_at desc,id desc) rn from public.celebrity_schedules
    where (p_status is null or status=p_status) and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit v_limit+1)
  select jsonb_build_object('items',coalesce(jsonb_agg(public.fan_web_schedule_json(id,null,'ko',true) order by created_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),
    'nextCursor',case when count(*)>v_limit then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=v_limit) end) into v_result from rows;
  return v_result;
end $$;

create function public.fan_web_admin_list_schedule_suggestions(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_status text,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  with rows as materialized(select id,created_at,row_number() over(order by created_at desc,id desc) rn from public.schedule_suggestions
    where (p_status is null or status=p_status) and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit v_limit+1)
  select jsonb_build_object('items',coalesce(jsonb_agg(public.fan_web_suggestion_json(id) order by created_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),
    'nextCursor',case when count(*)>v_limit then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=v_limit) end) into v_result from rows;
  return v_result;
end $$;

create function public.fan_web_admin_list_fanpage_requests(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_status text,p_locale public.content_locale,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  with rows as materialized(select id,created_at,row_number() over(order by created_at desc,id desc) rn from public.fanpage_requests
    where (p_status is null or status=p_status) and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit v_limit+1)
  select jsonb_build_object('items',coalesce(jsonb_agg(public.fan_web_request_json(id,p_locale) order by created_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),
    'nextCursor',case when count(*)>v_limit then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=v_limit) end) into v_result from rows;
  return v_result;
end $$;

create function public.fan_web_admin_list_live_submissions(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_live_event_id uuid,p_status text,p_before_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  with rows as materialized(select *,row_number() over(order by created_at desc,id desc) rn from public.live_fan_submissions
    where live_event_id=p_live_event_id and (p_status is null or status=p_status) and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit v_limit+1)
  select jsonb_build_object('settings',public.fan_web_live_settings_json(p_live_event_id),
    'items',coalesce(jsonb_agg(public.fan_web_owned_submission_json(r.id,true)||jsonb_build_object('nickname',coalesce(nullif(btrim(p.nickname),''),'팬'),'avatarUrl','/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp') order by r.created_at desc,r.id desc) filter(where r.rn<=v_limit),'[]'::jsonb),
    'nextCursor',case when count(*)>v_limit then (select jsonb_build_object('at',created_at,'id',id) from rows where rn=v_limit) end) into v_result
    from rows r left join public.user_profiles p on p.app_user_id=r.app_user_id left join public.app_user_avatars a on a.app_user_id=r.app_user_id;
  return v_result;
end $$;

create or replace function public.get_owned_live_missions(p_app_user_id uuid,p_live_slug text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  with missions as (
    select m.*,l.celebrity_id,c.slug celebrity_slug,r.submitted_at completed_at,
      case when r.id is not null then 'completed'
        when clock_timestamp()<m.visible_from or clock_timestamp()>=m.visible_until then 'closed'
        when not public.fan_web_is_member(p_app_user_id,c.id) then 'passport_required'
        when not exists(select 1 from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded') then 'wallet_pending'
        when m.attendance_requirement='required' and not exists(select 1 from public.live_attendances where app_user_id=p_app_user_id and live_event_id=l.id) then 'attendance_required'
        else 'available' end eligibility
    from public.live_surveys m join public.live_events l on l.id=m.live_event_id
    join public.celebrities c on c.id=l.celebrity_id
    left join public.live_survey_responses r on r.survey_id=m.id and r.app_user_id=p_app_user_id and r.status='submitted'
    where l.slug=p_live_slug and l.publication_status='published' and l.archived_at is null
      and c.status='published' and c.archived_at is null and m.publication_status='published' and not m.legacy_contract
      and exists(select 1 from public.app_users where id=p_app_user_id and status='active')
      and (r.id is not null or (clock_timestamp()>=m.visible_from and clock_timestamp()<m.visible_until))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'type',m.mission_type,'version',m.version,'title',ml.title,'description',ml.description,
    'visibleFrom',m.visible_from,'visibleUntil',m.visible_until,'attendanceRequired',m.attendance_requirement='required','completed',m.completed_at is not null,
    'completedAt',m.completed_at,'eligibility',m.eligibility,'nextAction',jsonb_build_object(
      'kind',case m.eligibility when 'available' then 'answer' when 'passport_required' then 'verify_fan' when 'attendance_required' then 'check_in' when 'wallet_pending' then 'wait_wallet' when 'completed' then 'view_record' else 'unavailable' end,
      'href',case m.eligibility when 'passport_required' then '/c/'||m.celebrity_slug||'/verify' when 'attendance_required' then '/live/'||p_live_slug||'#attendance' when 'completed' then '/c/'||m.celebrity_slug||'/certifications' else null end),
    'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'text',ql.question_text,'media',case when q.media_type is null then null else jsonb_build_object('type',q.media_type,'url',q.media_url) end,
      'options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',ol.label,'displayMode',o.display_mode,'media',case when o.media_type is null then null else jsonb_build_object('type',o.media_type,'url',o.media_url) end) order by o.position),'[]'::jsonb)
        from public.live_survey_options o join public.live_survey_option_localizations ol on ol.option_id=o.id and ol.locale=p_locale where o.question_id=q.id)) order by q.position),'[]'::jsonb)
      from public.live_survey_questions q join public.live_survey_question_localizations ql on ql.question_id=q.id and ql.locale=p_locale where q.survey_id=m.id)) order by m.version),'[]'::jsonb)
    from missions m join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale;
$$;

alter function public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text) rename to submit_owned_live_mission_before_fan_web;
revoke all on function public.submit_owned_live_mission_before_fan_web(uuid,uuid,uuid,jsonb,uuid,text,text) from public,anon,authenticated,service_role;
create function public.submit_owned_live_mission(p_app_user_id uuid,p_mission_id uuid,p_idempotency_key uuid,p_answers jsonb,p_stamp_id uuid,p_stamp_operation_key text,p_stamp_issuance_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if not exists(select 1 from public.live_surveys m join public.live_events l on l.id=m.live_event_id join public.celebrities c on c.id=l.celebrity_id
    where m.id=p_mission_id and m.publication_status='published' and l.publication_status='published' and l.archived_at is null and c.status='published' and c.archived_at is null)
    then raise exception 'PHASE2_MISSION_NOT_FOUND'; end if;
  return public.submit_owned_live_mission_before_fan_web(p_app_user_id,p_mission_id,p_idempotency_key,p_answers,p_stamp_id,p_stamp_operation_key,p_stamp_issuance_id);
end $$;

alter table public.celebrity_schedules enable row level security;
alter table public.celebrity_schedules force row level security;
revoke all on public.celebrity_schedules from public,anon,authenticated,service_role;

alter table public.schedule_subscriptions enable row level security;
alter table public.schedule_subscriptions force row level security;
revoke all on public.schedule_subscriptions from public,anon,authenticated,service_role;

alter table public.schedule_suggestions enable row level security;
alter table public.schedule_suggestions force row level security;
revoke all on public.schedule_suggestions from public,anon,authenticated,service_role;

alter table public.live_fan_submission_settings enable row level security;
alter table public.live_fan_submission_settings force row level security;
revoke all on public.live_fan_submission_settings from public,anon,authenticated,service_role;

alter table public.live_fan_submissions enable row level security;
alter table public.live_fan_submissions force row level security;
revoke all on public.live_fan_submissions from public,anon,authenticated,service_role;

alter table public.fanpage_requests enable row level security;
alter table public.fanpage_requests force row level security;
revoke all on public.fanpage_requests from public,anon,authenticated,service_role;

do $$ declare r record; begin
  for r in select p.oid::regprocedure signature,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['fan_web_https_url','fan_web_social_profile_key','fan_web_time_zone','fan_web_replay_url','fan_web_participation_audit','fan_web_schedule_json','fan_web_suggestion_json','fan_web_request_json','fan_web_owned_submission_json','fan_web_live_settings_json','fan_web_list_schedules','fan_web_list_owned_schedule_suggestions','fan_web_list_owned_fanpage_requests','fan_web_submit_schedule_suggestion','fan_web_check_fanpage_request','fan_web_submit_fanpage_request','fan_web_admin_save_schedule','fan_web_admin_review_schedule_suggestion','fan_web_admin_review_fanpage_request','fan_web_get_schedule','fan_web_set_schedule_subscription','fan_web_get_live_submission_target','fan_web_list_live_submissions','fan_web_submit_live_submission','fan_web_delete_live_submission','fan_web_admin_save_live_submission_settings','fan_web_admin_review_live_submission','fan_web_hide_live_submission','fan_web_admin_save_live_replay','fan_web_admin_list_schedules','fan_web_admin_list_schedule_suggestions','fan_web_admin_list_fanpage_requests','fan_web_admin_list_live_submissions','get_owned_live_missions','submit_owned_live_mission']) loop
    execute 'revoke all on function '||r.signature||' from public,anon,authenticated,service_role';
    if r.proname<>all(array['fan_web_https_url','fan_web_live_settings_json','fan_web_owned_submission_json','fan_web_participation_audit','fan_web_replay_url','fan_web_request_json','fan_web_schedule_json','fan_web_social_profile_key','fan_web_suggestion_json','fan_web_time_zone']) then
      execute 'grant execute on function '||r.signature||' to service_role';
    end if;
  end loop;
end $$;

create function public.fan_web_admin_get_live_replay(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_live_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object('liveEventId',id,'replayProvider',replay_provider,'replayUrl',replay_url,'replayPublished',replay_published,'replayRevision',replay_revision) into v_result from public.live_events where id=p_live_event_id;
  if v_result is null then raise exception 'FAN_WEB_NOT_FOUND'; end if;
  return v_result;
end $$;
revoke all on function public.fan_web_admin_get_live_replay(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fan_web_admin_get_live_replay(uuid,uuid,uuid,uuid) to service_role;
