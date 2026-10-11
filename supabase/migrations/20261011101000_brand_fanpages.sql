begin;

alter table public.celebrities
  add column website_url text,
  add constraint celebrities_website_url_https check (
    website_url is null or (
      char_length(website_url) between 9 and 2048
      and website_url ~ '^https://[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'
    )
  ),
  add constraint celebrities_brand_role_consistency check (
    (primary_role = 'brand' and roles = array['brand'::public.celebrity_role])
    or (
      primary_role is distinct from 'brand'
      and not ('brand'::public.celebrity_role = any(roles))
    )
  );

comment on column public.celebrities.website_url is
  'Optional public HTTPS website. Credentials, whitespace and control characters are not accepted.';

create function public.prevent_celebrity_brand_conversion()
returns trigger
language plpgsql
set search_path = '' as $$
begin
  if (old.primary_role = 'brand' and new.primary_role is distinct from 'brand')
    or (new.primary_role = 'brand' and old.primary_role is distinct from 'brand') then
    raise exception 'existing person and brand profiles cannot be converted'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger celebrities_prevent_brand_conversion
before update of primary_role on public.celebrities
for each row execute function public.prevent_celebrity_brand_conversion();

create function public.reject_brand_quiz_or_passport()
returns trigger
language plpgsql
set search_path = '' as $$
begin
  if exists (
    select 1 from public.celebrities c
    where c.id = new.celebrity_id and c.primary_role = 'brand'
  ) then
    raise exception 'brand profiles do not support quizzes or passports'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger celebrity_quizzes_reject_brand
before insert or update of celebrity_id on public.celebrity_quizzes
for each row execute function public.reject_brand_quiz_or_passport();

create trigger fan_passports_reject_brand
before insert or update of celebrity_id on public.fan_passports
for each row execute function public.reject_brand_quiz_or_passport();

revoke all on function public.prevent_celebrity_brand_conversion(),
  public.reject_brand_quiz_or_passport()
from public, anon, authenticated, service_role;

create or replace view public.published_celebrities
with (security_barrier = true, security_invoker = true)
as
select
  c.slug,
  l.locale,
  l.name,
  l.summary,
  c.image_url,
  l.image_alt,
  c.image_position,
  coalesce(theme_data.items, '[]'::jsonb) as themes,
  coalesce(social_data.items, '[]'::jsonb) as social_links,
  c.display_order,
  c.fan_count,
  c.roles,
  c.primary_role,
  c.website_url
from public.celebrities c
join public.celebrity_localizations l on l.celebrity_id = c.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object('slug', t.slug, 'name', tl.name)
    order by ct.position, t.slug
  ) as items
  from public.celebrity_themes ct
  join public.themes t on t.id = ct.theme_id and t.status = 'published'
  join public.theme_localizations tl
    on tl.theme_id = t.id and tl.locale = l.locale
  where ct.celebrity_id = c.id
) theme_data on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('platform', sl.platform, 'url', sl.url)
    order by sl.position, sl.platform
  ) as items
  from public.celebrity_social_links sl
  where sl.celebrity_id = c.id and sl.active
) social_data on true
where c.status = 'published'
  and c.fan_count is not null;

comment on view public.published_celebrities is
  'Published-only celebrity and brand DTO with operator-managed aggregate fan count. Contains no private CMS identifiers or audit metadata.';

revoke all on public.published_celebrities from public;
revoke all on public.published_celebrities from anon, authenticated;
grant select on public.published_celebrities to service_role;

create or replace function public.read_admin_celebrity_cms(
  p_actor uuid,
  p_celebrity uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_content_editor(p_actor, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'status', c.status,
      'imageUrl', c.image_url,
      'imagePosition', c.image_position,
      'displayOrder', c.display_order,
      'fanCount', c.fan_count,
      'roles', to_jsonb(c.roles),
      'primaryRole', c.primary_role,
      'websiteUrl', c.website_url,
      'publishedAt', c.published_at,
      'everPublishedAt', c.ever_published_at,
      'archivedAt', c.archived_at,
      'archiveReason', c.archive_reason,
      'updatedAt', c.updated_at,
      'localizations', (
        select jsonb_object_agg(
          l.locale,
          jsonb_build_object(
            'name', l.name,
            'summary', l.summary,
            'imageAlt', l.image_alt
          )
        )
        from public.celebrity_localizations l
        where l.celebrity_id = c.id
      ),
      'themes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'slug', t.slug,
          'nameKo', ko.name,
          'nameEn', en.name,
          'position', ct.position
        ) order by ct.position)
        from public.celebrity_themes ct
        join public.themes t on t.id = ct.theme_id
        left join public.theme_localizations ko
          on ko.theme_id = t.id and ko.locale = 'ko'
        left join public.theme_localizations en
          on en.theme_id = t.id and en.locale = 'en'
        where ct.celebrity_id = c.id
      ), '[]'::jsonb),
      'socialLinks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'platform', s.platform,
          'url', s.url,
          'position', s.position,
          'active', s.active
        ) order by s.position)
        from public.celebrity_social_links s
        where s.celebrity_id = c.id
      ), '[]'::jsonb)
    ) order by c.display_order, c.created_at desc)
    from public.celebrities c
    where p_celebrity is null or c.id = p_celebrity
  ), '[]'::jsonb);
end $$;

create or replace function public.save_admin_celebrity(
  p_actor uuid,
  p_correlation uuid,
  p_celebrity uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(p_celebrity, extensions.gen_random_uuid());
  before_row jsonb;
  result jsonb;
  theme_item jsonb;
  social_item jsonb;
  v_theme_id uuid;
  requested_fan_count bigint;
  requested_roles public.celebrity_role[];
  requested_primary_role public.celebrity_primary_role;
  requested_website_url text;
begin
  perform public.require_content_editor(p_actor, true);
  if p_correlation is null then
    raise exception 'correlation id is required';
  end if;
  if p_celebrity is not null then
    perform 1
    from public.celebrities c
    where id = p_celebrity and archived_at is null
    for update;
    if not found then raise exception 'content not found'; end if;
    before_row := public.read_admin_celebrity_cms(p_actor, p_celebrity)->0;
  end if;
  if coalesce(p_payload->>'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid celebrity slug';
  end if;

  if p_payload ? 'primaryRole' then
    if jsonb_typeof(p_payload->'primaryRole') is distinct from 'string'
      or (p_payload->>'primaryRole') not in ('idol','singer','actor','creator','show_host','brand') then
      raise exception 'invalid celebrity primary role';
    end if;
    requested_primary_role := (p_payload->>'primaryRole')::public.celebrity_primary_role;
  elsif p_celebrity is not null then
    select primary_role into requested_primary_role from public.celebrities where id = target;
  else
    raise exception 'celebrity creation requires a primary role';
  end if;

  if requested_primary_role = 'brand' then
    requested_roles := array['brand'::public.celebrity_role];
  elsif p_payload ? 'roles' then
    if jsonb_typeof(p_payload->'roles') <> 'array' then
      raise exception 'invalid celebrity roles';
    end if;
    if exists (select 1 from jsonb_array_elements(p_payload->'roles') r(value)
      where jsonb_typeof(r.value) <> 'string') then
      raise exception 'invalid celebrity roles';
    end if;
    select array_agg(value::public.celebrity_role order by position)
      into requested_roles
    from jsonb_array_elements_text(p_payload->'roles') with ordinality r(value, position);
    if requested_roles is null then raise exception 'celebrity roles are required'; end if;
  elsif p_celebrity is not null then
    select roles into requested_roles from public.celebrities where id = target;
  else
    requested_roles := array[case
      when requested_primary_role = 'creator' then 'creator'::public.celebrity_role
      when requested_primary_role = 'show_host' then 'show_host'::public.celebrity_role
      else 'artist'::public.celebrity_role
    end];
  end if;

  if p_payload ? 'websiteUrl' then
    if jsonb_typeof(p_payload->'websiteUrl') not in ('string', 'null') then
      raise exception 'invalid celebrity website url';
    end if;
    requested_website_url := p_payload->>'websiteUrl';
  elsif p_celebrity is not null then
    select website_url into requested_website_url from public.celebrities where id = target;
  end if;

  requested_fan_count := case
    when p_payload->'fanCount' is null
      or jsonb_typeof(p_payload->'fanCount') = 'null'
      then null
    else (p_payload->>'fanCount')::bigint
  end;
  if requested_fan_count is not null and requested_fan_count < 0 then
    raise exception 'invalid celebrity fan count';
  end if;

  if p_celebrity is null then
    insert into public.celebrities(
      id, slug, image_url, image_position, display_order, fan_count, roles, primary_role, website_url
    ) values (
      target,
      p_payload->>'slug',
      p_payload->>'imageUrl',
      coalesce(nullif(p_payload->>'imagePosition', ''), 'center'),
      coalesce((p_payload->>'displayOrder')::int, 0),
      requested_fan_count,
      requested_roles,
      requested_primary_role,
      requested_website_url
    );
  else
    update public.celebrities
    set slug = p_payload->>'slug',
        image_url = p_payload->>'imageUrl',
        image_position = coalesce(nullif(p_payload->>'imagePosition', ''), 'center'),
        display_order = coalesce((p_payload->>'displayOrder')::int, 0),
        fan_count = requested_fan_count,
        roles = requested_roles,
        primary_role = requested_primary_role,
        website_url = requested_website_url
    where id = target;
  end if;

  insert into public.celebrity_localizations(
    celebrity_id, locale, name, summary, image_alt
  )
  select
    target,
    x.locale::public.content_locale,
    x.value->>'name',
    x.value->>'summary',
    x.value->>'imageAlt'
  from jsonb_each(p_payload->'localizations') x(locale, value)
  on conflict (celebrity_id, locale) do update
  set name = excluded.name,
      summary = excluded.summary,
      image_alt = excluded.image_alt;

  delete from public.celebrity_social_links where celebrity_id = target;
  for social_item in
    select value from jsonb_array_elements(coalesce(p_payload->'socialLinks', '[]'))
  loop
    insert into public.celebrity_social_links(
      celebrity_id, platform, url, position, active
    ) values (
      target,
      (social_item->>'platform')::public.social_platform,
      social_item->>'url',
      (social_item->>'position')::smallint,
      coalesce((social_item->>'active')::boolean, true)
    );
  end loop;

  delete from public.celebrity_themes where celebrity_id = target;
  for theme_item in
    select value from jsonb_array_elements(coalesce(p_payload->'themes', '[]'))
  loop
    v_theme_id := null;
    select theme.id into v_theme_id
    from public.themes
    where theme.slug = theme_item->>'slug'
    for update;
    if v_theme_id is null then
      insert into public.themes(slug)
      values (theme_item->>'slug')
      returning id into v_theme_id;
      insert into public.theme_localizations(theme_id, locale, name)
      values
        (v_theme_id, 'ko', theme_item->>'nameKo'),
        (v_theme_id, 'en', theme_item->>'nameEn');
      update public.themes set status = 'published' where id = v_theme_id;
    else
      insert into public.theme_localizations(theme_id, locale, name)
      values
        (v_theme_id, 'ko', theme_item->>'nameKo'),
        (v_theme_id, 'en', theme_item->>'nameEn')
      on conflict (theme_id, locale) do update set name = excluded.name;
      if exists (select 1 from public.themes where id = v_theme_id and status = 'draft') then
        update public.themes set status = 'published' where id = v_theme_id;
      end if;
    end if;
    insert into public.celebrity_themes(celebrity_id, theme_id, position)
    values (target, v_theme_id, (theme_item->>'position')::smallint);
  end loop;

  select public.read_admin_celebrity_cms(p_actor, target)->0 into result;
  insert into public.audit_logs(
    actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    p_actor,
    case when p_celebrity is null then 'celebrity.created' else 'celebrity.updated' end,
    'celebrity',
    target::text,
    jsonb_build_object('before', before_row, 'after', result),
    p_correlation
  );
  return result;
end $$;

create or replace function public.set_admin_celebrity_publication(
  p_actor uuid,
  p_correlation uuid,
  p_celebrity uuid,
  p_publish boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb;
  result jsonb;
  is_brand boolean;
begin
  perform public.require_content_editor(p_actor, true);
  perform 1
  from public.celebrities c
  where id = p_celebrity and archived_at is null
  for update;
  before_row := public.read_admin_celebrity_cms(p_actor, p_celebrity)->0;
  if before_row is null then raise exception 'content not found'; end if;
  if p_publish then
    if (select primary_role from public.celebrities where id = p_celebrity) is null then
      raise exception 'celebrity publication requires a primary role';
    end if;
    if (select fan_count from public.celebrities where id = p_celebrity) is null then
      raise exception 'celebrity publication requires fan count';
    end if;
    select primary_role = 'brand' into is_brand
    from public.celebrities where id = p_celebrity;
    if not is_brand and (
      select count(*) from public.celebrity_quizzes q
      where q.celebrity_id = p_celebrity and q.status = 'published'
    ) <> 1 then
      raise exception 'celebrity publication requires exactly one published quiz';
    end if;
    if not is_brand and exists (
      select 1
      from public.celebrity_quizzes q
      where q.celebrity_id = p_celebrity
        and q.status = 'published'
        and (
          (select count(*) from public.celebrity_quiz_questions x
            where x.quiz_id = q.id and x.active) < 3
          or exists (
            select 1
            from public.celebrity_quiz_questions x
            where x.quiz_id = q.id and x.active
              and (
                (select count(*) from public.celebrity_quiz_options o
                  where o.question_id = x.id and o.active) <> 4
                or (select count(*) from public.celebrity_quiz_options o
                  where o.question_id = x.id and o.active and o.is_correct) <> 1
              )
          )
        )
    ) then
      raise exception 'celebrity publication requires a complete published quiz';
    end if;
  end if;
  update public.celebrities
  set status = case
    when p_publish then 'published'::public.content_status
    else 'draft'::public.content_status
  end
  where id = p_celebrity;
  select public.read_admin_celebrity_cms(p_actor, p_celebrity)->0 into result;
  insert into public.audit_logs(
    actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    p_actor,
    case when p_publish then 'celebrity.published' else 'celebrity.unpublished' end,
    'celebrity',
    p_celebrity::text,
    jsonb_build_object('before', before_row, 'after', result),
    p_correlation
  );
  return result;
end $$;

-- Keep the established localized welcome copy intact while excluding brands
-- at the idempotent issuer itself, including internal direct calls.
do $$
declare
  v_signature regprocedure := 'public.ensure_celebrity_welcome_notice(uuid)'::regprocedure;
  v_definition text;
  v_old text := $patch$if not found
     or v_celebrity.status <> 'published'
     or v_celebrity.archived_at is not null then$patch$;
  v_new text := $patch$if not found
     or v_celebrity.status <> 'published'
     or v_celebrity.archived_at is not null
     or v_celebrity.primary_role = 'brand' then$patch$;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'WELCOME_NOTICE_ISSUER_SHAPE_CHANGED';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end $$;

comment on function public.ensure_celebrity_welcome_notice(uuid) is
  'Internal idempotent bootstrap for operator-signed KO/EN person welcome notices; brand profiles are excluded.';

create or replace function public.issue_first_reaction_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare activity_id uuid:=extensions.gen_random_uuid(); passport_id uuid;
begin
  if exists (select 1 from public.celebrities c
    where c.id=new.celebrity_id and c.primary_role='brand') then return new; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
  values(activity_id,new.app_user_id,new.celebrity_id,'first_reaction','fan_reaction',new.id,new.completed_at)
  on conflict(activity_type,source_type,source_id) do nothing;
  select id into strict activity_id from public.fan_activities where activity_type='first_reaction' and source_type='fan_reaction' and source_id=new.id;
  select id into passport_id from public.fan_passports where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and business_status='issued';
  insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id)
  values(new.id,new.app_user_id,new.celebrity_id,passport_id,activity_id,new.id,new.mint_status,new.tx_hash,new.token_id)
  on conflict(reaction_id) do nothing;
  return new;
end $$;

create or replace function public.recover_first_comment_community_stamp(
  p_app_user_id uuid,p_celebrity_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_source_key text;
begin
  if exists(select 1 from public.community_stamps stamp
    where stamp.app_user_id=p_app_user_id and stamp.celebrity_id=p_celebrity_id
      and stamp.kind='first_comment') then return false; end if;
  if not exists(select 1 from public.celebrities celebrity
    where celebrity.id=p_celebrity_id and celebrity.status='published'
      and celebrity.archived_at is null and celebrity.primary_role<>'brand') then return false; end if;
  select source_key into v_source_key from (
    select 'first-comment:lounge:'||message.id::text source_key,message.created_at,message.id
      from public.fan_lounge_messages message
      where message.app_user_id=p_app_user_id and message.celebrity_id=p_celebrity_id
    union all
    select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
    union all
    select 'first-comment:post:'||post.id::text,post.created_at,post.id
      from public.fan_posts post
      where post.app_user_id=p_app_user_id and post.celebrity_id=p_celebrity_id
        and post.first_comment_eligible
  ) comments order by created_at,id,source_key limit 1;
  if v_source_key is null then return false; end if;
  return public.issue_community_stamp(
    p_app_user_id,p_celebrity_id,'first_comment',v_source_key);
end $$;

create or replace function public.fan_ticket_activity_sources(p_owner uuid default null,p_creator uuid default null)
returns table(app_user_id uuid,celebrity_id uuid,action_key text,scope_key text,source_id uuid,occurred_at timestamptz)
language sql stable security definer set search_path='' as $$
with eligible as (
 select c.id from public.celebrities c join public.fan_ticket_activity_policy p on p.celebrity_id=c.id
 where p.enabled and c.status='published' and c.archived_at is null and c.primary_role<>'brand'
   and (p_creator is null or c.id=p_creator)
), evidence as (
 select q.app_user_id,q.celebrity_id,'verification'::text action_key,'once'::text scope_key,q.id source_id,q.passed_at occurred_at
 from public.quiz_passes q join eligible c on c.id=q.celebrity_id where p_owner is null or q.app_user_id=p_owner
 union all
 select r.app_user_id,r.celebrity_id,'reaction','once',r.id,r.completed_at
 from public.fan_reactions r join eligible c on c.id=r.celebrity_id where p_owner is null or r.app_user_id=p_owner
 union all
 select m.app_user_id,m.celebrity_id,'comment','once',m.id,m.created_at
 from public.fan_lounge_messages m join eligible c on c.id=m.celebrity_id where p_owner is null or m.app_user_id=p_owner
 union all
 select m.app_user_id,n.celebrity_id,'comment','once',m.id,m.created_at
 from public.celebrity_notice_comments m join public.celebrity_notices n on n.id=m.notice_id join eligible c on c.id=n.celebrity_id
 where p_owner is null or m.app_user_id=p_owner
 union all
 select p.app_user_id,p.celebrity_id,'comment','once',p.id,p.created_at
 from public.fan_posts p join eligible c on c.id=p.celebrity_id
 where p.first_comment_eligible and (p_owner is null or p.app_user_id=p_owner)
 union all
 select s.app_user_id,s.celebrity_id,'checkin',split_part(s.source_key,':',3),s.id,s.issued_at
 from public.community_stamps s join eligible c on c.id=s.celebrity_id
 where s.kind='daily_checkin' and (p_owner is null or s.app_user_id=p_owner)
 union all
 select s.app_user_id,s.celebrity_id,'membership_'||s.membership_platform::text,'once',s.id,s.reviewed_at
 from public.certification_submissions s join eligible c on c.id=s.celebrity_id
 where s.status='approved' and s.membership_platform is not null and (p_owner is null or s.app_user_id=p_owner)
 union all
 select l.owner_app_user_id,l.celebrity_id,'share','once',v.id,v.visited_at
 from public.community_stamp_share_visits v join public.community_stamp_share_links l on l.id=v.share_link_id
 join eligible c on c.id=l.celebrity_id
 where v.visitor_app_user_id<>l.owner_app_user_id and (p_owner is null or l.owner_app_user_id=p_owner)
)
select distinct on(e.app_user_id,e.celebrity_id,e.action_key,e.scope_key) e.*
from evidence e join public.app_users u on u.id=e.app_user_id and u.status='active'
order by e.app_user_id,e.celebrity_id,e.action_key,e.scope_key,e.occurred_at,e.source_id;
$$;

create or replace function public.reward_fan_ticket_activity_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; creator_id uuid; action text; scope text:='once';
begin
 if tg_table_name='community_stamp_share_visits' then
   select l.owner_app_user_id,l.celebrity_id into owner_id,creator_id from public.community_stamp_share_links l where l.id=new.share_link_id;
   action:='share';
 else
   owner_id:=new.app_user_id;
   if tg_table_name='celebrity_notice_comments' then
     select n.celebrity_id into creator_id from public.celebrity_notices n where n.id=new.notice_id;
   else creator_id:=new.celebrity_id; end if;
   case tg_table_name
   when 'quiz_passes' then action:='verification';
   when 'fan_reactions' then action:='reaction';
   when 'fan_lounge_messages','celebrity_notice_comments' then action:='comment';
   when 'fan_posts' then
     if not new.first_comment_eligible then return new; end if;
     action:='comment';
   when 'community_stamps' then
     if new.kind<>'daily_checkin' then return new; end if;
     action:='checkin';scope:=split_part(new.source_key,':',3);
   when 'certification_submissions' then
     if new.status<>'approved' or new.membership_platform is null then return new; end if;
     action:='membership_'||new.membership_platform::text;
   else return new;
   end case;
 end if;
 if exists (select 1 from public.celebrities c
   where c.id=creator_id and c.primary_role='brand') then return new; end if;
 perform public.award_fan_ticket_activity(owner_id,creator_id,action,scope,false);
 return new;
end $$;

commit;
