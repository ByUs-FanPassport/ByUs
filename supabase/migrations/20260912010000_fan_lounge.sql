-- A persisted, near-live creator lounge. Notice comments remain a separate domain.
create table public.fan_lounge_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 1000),
  idempotency_key uuid not null,
  reply_to_id uuid references public.fan_lounge_messages(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_admin_id uuid references public.admin_allowlist(id) on delete restrict,
  removal_reason text,
  unique(app_user_id,idempotency_key),
  constraint fan_lounge_message_not_self_reply check (reply_to_id is null or reply_to_id <> id)
);

create index fan_lounge_messages_visible_idx
  on public.fan_lounge_messages(celebrity_id,created_at desc,id desc)
  where removed_at is null;
create index fan_lounge_messages_rate_idx
  on public.fan_lounge_messages(app_user_id,created_at desc);

create table public.fan_lounge_message_reactions (
  message_id uuid not null references public.fan_lounge_messages(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  emoji text not null check (emoji in ('❤️','👍','😂','🥹','🔥','👏')),
  created_at timestamptz not null default now(),
  primary key(message_id,app_user_id,emoji)
);
create index fan_lounge_message_reactions_owner_idx
  on public.fan_lounge_message_reactions(app_user_id,message_id);

create table public.fan_lounge_reaction_mutation_events (
  id bigint generated always as identity primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  message_id uuid not null references public.fan_lounge_messages(id) on delete restrict,
  emoji text not null check (emoji in ('❤️','👍','😂','🥹','🔥','👏')),
  enabled boolean not null,
  created_at timestamptz not null default now()
);
create index fan_lounge_reaction_mutation_events_rate_idx
  on public.fan_lounge_reaction_mutation_events(app_user_id,created_at desc);

alter table public.fan_lounge_messages enable row level security;
alter table public.fan_lounge_messages force row level security;
alter table public.fan_lounge_message_reactions enable row level security;
alter table public.fan_lounge_message_reactions force row level security;
alter table public.fan_lounge_reaction_mutation_events enable row level security;
alter table public.fan_lounge_reaction_mutation_events force row level security;
revoke all on table public.fan_lounge_messages from public,anon,authenticated,service_role;
revoke all on table public.fan_lounge_message_reactions from public,anon,authenticated,service_role;
revoke all on table public.fan_lounge_reaction_mutation_events from public,anon,authenticated,service_role;

create function public.read_celebrity_lounge(
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
    where m.removed_at is null
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
        where r.message_id=p.id
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

create function public.post_celebrity_lounge_message(
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
    where parent.id=p_reply_to_id and parent.celebrity_id=v_creator_id and parent.removed_at is null
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

create function public.remove_owned_lounge_message(p_app_user_id uuid,p_message_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.app_users u where u.id=p_app_user_id and u.status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501';
  end if;
  update public.fan_lounge_messages m set removed_at=coalesce(m.removed_at,now())
  from public.celebrities c
  where m.id=p_message_id and m.app_user_id=p_app_user_id and m.celebrity_id=c.id
    and c.status='published' and c.archived_at is null;
  if not found then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
end $$;

create function public.set_lounge_message_reaction(
  p_app_user_id uuid,p_message_id uuid,p_emoji text,p_enabled boolean
) returns void language plpgsql security definer set search_path='' as $$
declare v_exists boolean;
begin
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
    where m.id=p_message_id and m.removed_at is null
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

create function public.read_admin_lounge_messages(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,
  p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object('messages',coalesce(jsonb_agg(row.body order by row.created_at desc,row.id desc),'[]'::jsonb))
  into v_result from (
    select m.created_at,m.id,jsonb_build_object(
      'id',m.id,'body',m.body,'nickname',coalesce(nullif(btrim(p.nickname),''),'팬'),
      'celebritySlug',c.slug,'createdAt',m.created_at
    ) body
    from public.fan_lounge_messages m
    join public.celebrities c on c.id=m.celebrity_id and c.status='published' and c.archived_at is null
    join public.app_users u on u.id=m.app_user_id and u.status='active'
    left join public.user_profiles p on p.app_user_id=m.app_user_id
    where m.removed_at is null and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit least(greatest(p_limit,1),50)
  ) row;
  return v_result;
end $$;

create function public.hide_admin_lounge_message(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_message_id uuid,p_reason text
) returns void language plpgsql security definer set search_path='' as $$
begin
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

revoke all on function public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale),
  public.post_celebrity_lounge_message(uuid,text,text,uuid,uuid,public.content_locale),
  public.remove_owned_lounge_message(uuid,uuid),public.set_lounge_message_reaction(uuid,uuid,text,boolean),
  public.read_admin_lounge_messages(uuid,uuid,timestamptz,uuid,integer),
  public.hide_admin_lounge_message(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale),
  public.post_celebrity_lounge_message(uuid,text,text,uuid,uuid,public.content_locale),
  public.remove_owned_lounge_message(uuid,uuid),public.set_lounge_message_reaction(uuid,uuid,text,boolean),
  public.read_admin_lounge_messages(uuid,uuid,timestamptz,uuid,integer),
  public.hide_admin_lounge_message(uuid,uuid,uuid,uuid,text)
  to service_role;
