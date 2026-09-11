create table public.cs_inquiries (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  subject text not null,
  locale text not null,
  status text not null default 'open',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cs_inquiries_subject_valid
    check (subject = btrim(subject) and length(subject) between 1 and 120),
  constraint cs_inquiries_locale_valid check (locale in ('ko', 'en')),
  constraint cs_inquiries_status_valid check (status in ('open', 'answered', 'resolved')),
  constraint cs_inquiries_version_valid check (version >= 1)
);

create index cs_inquiries_owner_updated_idx
  on public.cs_inquiries (app_user_id, updated_at desc, id desc);
create index cs_inquiries_admin_updated_idx
  on public.cs_inquiries (status, updated_at desc, id desc);

create table public.cs_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  inquiry_id uuid not null references public.cs_inquiries(id) on delete restrict,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  operation text not null,
  body text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint cs_messages_body_valid
    check (body = btrim(body) and length(body) between 1 and 4000),
  constraint cs_messages_operation_valid check (operation in ('create', 'post')),
  constraint cs_messages_actor_idempotency_unique
    unique (actor_app_user_id, idempotency_key)
);

create index cs_messages_inquiry_created_idx
  on public.cs_messages (inquiry_id, created_at desc, id desc);
create index cs_messages_fan_rate_idx
  on public.cs_messages (actor_app_user_id, created_at desc)
  where actor_admin_allowlist_id is null;

alter table public.cs_inquiries enable row level security;
alter table public.cs_inquiries force row level security;
alter table public.cs_messages enable row level security;
alter table public.cs_messages force row level security;

revoke all on public.cs_inquiries from public, anon, authenticated, service_role;
revoke all on public.cs_messages from public, anon, authenticated, service_role;

create function public.cs_list(
  p_app_user_id uuid,
  p_admin_allowlist_id uuid default null,
  p_status text default null,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if p_admin_allowlist_id is null then
    if not exists (
      select 1 from public.app_users
      where id = p_app_user_id and status = 'active'
    ) then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end if;
  else
    begin
      perform public.assert_active_admin(p_app_user_id, p_admin_allowlist_id, false);
    exception when others then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end;
  end if;

  if (p_status is not null and p_status not in ('open', 'answered', 'resolved'))
    or ((p_before is null) <> (p_before_id is null)) then
    raise exception 'CS_INVALID_REQUEST' using errcode = '22023';
  end if;

  with page as materialized (
    select i.id, i.subject, i.locale, i.status, i.version,
      coalesce(p.nickname, 'ByUs fan') as requester_name,
      i.created_at, i.updated_at
    from public.cs_inquiries i
    left join public.user_profiles p on p.app_user_id = i.app_user_id
    where (p_admin_allowlist_id is not null or i.app_user_id = p_app_user_id)
      and (p_status is null or i.status = p_status)
      and (p_before is null or (i.updated_at, i.id) < (p_before, p_before_id))
    order by i.updated_at desc, i.id desc
    limit 21
  ), selected as (
    select * from page
    order by updated_at desc, id desc
    limit 20
  )
  select jsonb_build_object(
    'inquiries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'subject', subject,
        'locale', locale,
        'status', status,
        'version', version,
        'requesterName', requester_name,
        'createdAt', created_at,
        'updatedAt', updated_at
      ) order by updated_at desc, id desc)
      from selected
    ), '[]'::jsonb),
    'hasMore', (select count(*) > 20 from page)
  ) into v_result;

  return v_result;
end $$;

create function public.cs_read(
  p_app_user_id uuid,
  p_inquiry_id uuid,
  p_admin_allowlist_id uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inquiry public.cs_inquiries%rowtype;
  v_requester_name text;
  v_messages jsonb;
  v_has_more boolean;
begin
  if p_admin_allowlist_id is null then
    if not exists (
      select 1 from public.app_users
      where id = p_app_user_id and status = 'active'
    ) then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end if;
  else
    begin
      perform public.assert_active_admin(p_app_user_id, p_admin_allowlist_id, false);
    exception when others then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end;
  end if;

  if p_inquiry_id is null or ((p_before is null) <> (p_before_id is null)) then
    raise exception 'CS_INVALID_REQUEST' using errcode = '22023';
  end if;

  select i.*
  into v_inquiry
  from public.cs_inquiries i
  where i.id = p_inquiry_id
    and (p_admin_allowlist_id is not null or i.app_user_id = p_app_user_id);

  if not found then
    raise exception 'CS_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(p.nickname, 'ByUs fan') into v_requester_name
  from (select v_inquiry.app_user_id as app_user_id) owner
  left join public.user_profiles p on p.app_user_id = owner.app_user_id;

  with page as materialized (
    select m.id, m.body,
      case when m.actor_admin_allowlist_id is null then 'fan' else 'admin' end as sender,
      m.created_at
    from public.cs_messages m
    where m.inquiry_id = p_inquiry_id
      and (p_before is null or (m.created_at, m.id) < (p_before, p_before_id))
    order by m.created_at desc, m.id desc
    limit 51
  ), selected as (
    select * from page
    order by created_at desc, id desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'body', body,
      'sender', sender,
      'createdAt', created_at
    ) order by created_at, id), '[]'::jsonb),
    (select count(*) > 50 from page)
  into v_messages, v_has_more
  from selected;

  return jsonb_build_object(
    'inquiry', jsonb_build_object(
      'id', v_inquiry.id,
      'subject', v_inquiry.subject,
      'locale', v_inquiry.locale,
      'status', v_inquiry.status,
      'version', v_inquiry.version,
      'requesterName', v_requester_name,
      'createdAt', v_inquiry.created_at,
      'updatedAt', v_inquiry.updated_at
    ),
    'messages', v_messages,
    'hasMore', v_has_more
  );
end $$;

create function public.cs_create(
  p_app_user_id uuid,
  p_subject text,
  p_body text,
  p_locale text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_subject text := btrim(p_subject);
  v_body text := btrim(p_body);
  v_existing record;
  v_inquiry_id uuid;
  v_now timestamptz;
begin
  if not exists (
    select 1 from public.app_users
    where id = p_app_user_id and status = 'active'
  ) then
    raise exception 'CS_FORBIDDEN' using errcode = '42501';
  end if;

  if p_idempotency_key is null
    or v_subject is null or length(v_subject) not between 1 and 120
    or v_body is null or length(v_body) not between 1 and 4000
    or p_locale is null or p_locale not in ('ko', 'en') then
    raise exception 'CS_INVALID_REQUEST' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cs:actor:' || p_app_user_id::text, 0)
  );

  select m.id as message_id, m.inquiry_id, m.operation, m.body, m.actor_admin_allowlist_id,
    m.created_at as message_created_at, i.app_user_id, i.subject, i.locale,
    i.created_at as inquiry_created_at,
    (select first_message.id
      from public.cs_messages first_message
      where first_message.inquiry_id = i.id
      order by first_message.created_at, first_message.id
      limit 1) as first_message_id
  into v_existing
  from public.cs_messages m
  join public.cs_inquiries i on i.id = m.inquiry_id
  where m.actor_app_user_id = p_app_user_id
    and m.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.app_user_id is distinct from p_app_user_id
      or v_existing.actor_admin_allowlist_id is not null
      or v_existing.operation is distinct from 'create'
      or v_existing.subject is distinct from v_subject
      or v_existing.locale is distinct from p_locale
      or v_existing.body is distinct from v_body
      or v_existing.message_id is distinct from v_existing.first_message_id
      or v_existing.message_created_at is distinct from v_existing.inquiry_created_at then
      raise exception 'CS_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.inquiry_id, 'replayed', true);
  end if;

  if (select count(*) from public.cs_inquiries
      where app_user_id = p_app_user_id
        and created_at > pg_catalog.clock_timestamp() - interval '10 minutes') >= 5
    or (select count(*) from public.cs_messages
      where actor_app_user_id = p_app_user_id
        and actor_admin_allowlist_id is null
        and created_at > pg_catalog.clock_timestamp() - interval '1 minute') >= 20 then
    raise exception 'CS_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.cs_inquiries(app_user_id, subject, locale, created_at, updated_at)
  values(p_app_user_id, v_subject, p_locale, v_now, v_now)
  returning id into v_inquiry_id;

  insert into public.cs_messages(
    inquiry_id, actor_app_user_id, operation, body, idempotency_key, created_at
  ) values (
    v_inquiry_id, p_app_user_id, 'create', v_body, p_idempotency_key, v_now
  );

  return jsonb_build_object('id', v_inquiry_id, 'replayed', false);
end $$;

create function public.cs_post(
  p_app_user_id uuid,
  p_inquiry_id uuid,
  p_body text,
  p_idempotency_key uuid,
  p_admin_allowlist_id uuid default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(p_body);
  v_inquiry public.cs_inquiries%rowtype;
  v_existing public.cs_messages%rowtype;
  v_message_id uuid;
  v_next_status text;
  v_now timestamptz;
  v_before_version integer;
begin
  if p_admin_allowlist_id is null then
    if not exists (
      select 1 from public.app_users
      where id = p_app_user_id and status = 'active'
    ) then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end if;
  else
    begin
      perform public.assert_active_admin(p_app_user_id, p_admin_allowlist_id, true);
    exception when others then
      raise exception 'CS_FORBIDDEN' using errcode = '42501';
    end;
  end if;

  if p_inquiry_id is null or p_idempotency_key is null
    or v_body is null or length(v_body) not between 1 and 4000
    or (p_admin_allowlist_id is null and p_correlation_id is not null)
    or (p_admin_allowlist_id is not null and p_correlation_id is null) then
    raise exception 'CS_INVALID_REQUEST' using errcode = '22023';
  end if;

  if p_admin_allowlist_id is null then
    select * into v_inquiry from public.cs_inquiries
    where id = p_inquiry_id and app_user_id = p_app_user_id
    for update;
  else
    select * into v_inquiry from public.cs_inquiries
    where id = p_inquiry_id
    for update;
  end if;

  if not found then
    raise exception 'CS_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cs:actor:' || p_app_user_id::text, 0)
  );

  select * into v_existing
  from public.cs_messages
  where actor_app_user_id = p_app_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.inquiry_id is distinct from p_inquiry_id
      or v_existing.operation is distinct from 'post'
      or v_existing.body is distinct from v_body
      or v_existing.actor_admin_allowlist_id is distinct from p_admin_allowlist_id then
      raise exception 'CS_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'replayed', true);
  end if;

  if p_admin_allowlist_id is null and (
    select count(*) from public.cs_messages
    where actor_app_user_id = p_app_user_id
      and actor_admin_allowlist_id is null
      and created_at > pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 20 then
    raise exception 'CS_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_next_status := case when p_admin_allowlist_id is null then 'open' else 'answered' end;
  v_before_version := v_inquiry.version;

  insert into public.cs_messages(
    inquiry_id, actor_app_user_id, actor_admin_allowlist_id,
    operation, body, idempotency_key, created_at
  ) values (
    p_inquiry_id, p_app_user_id, p_admin_allowlist_id,
    'post', v_body, p_idempotency_key, v_now
  ) returning id into v_message_id;

  update public.cs_inquiries
  set status = v_next_status,
    version = version + 1,
    updated_at = v_now
  where id = p_inquiry_id;

  if p_admin_allowlist_id is not null then
    insert into public.audit_logs(
      actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
      entity_id, correlation_id, before_after_summary
    ) values (
      p_app_user_id, p_admin_allowlist_id, 'cs.inquiry.reply', 'cs_inquiry',
      p_inquiry_id::text, p_correlation_id,
      jsonb_build_object(
        'messageId', v_message_id,
        'statusBefore', v_inquiry.status,
        'statusAfter', v_next_status,
        'versionBefore', v_before_version,
        'versionAfter', v_before_version + 1
      )
    );
  end if;

  return jsonb_build_object('id', v_message_id, 'replayed', false);
end $$;

create function public.cs_resolve(
  p_app_user_id uuid,
  p_admin_allowlist_id uuid,
  p_inquiry_id uuid,
  p_expected_version integer,
  p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inquiry public.cs_inquiries%rowtype;
  v_now timestamptz;
begin
  begin
    perform public.assert_active_admin(p_app_user_id, p_admin_allowlist_id, true);
  exception when others then
    raise exception 'CS_FORBIDDEN' using errcode = '42501';
  end;

  if p_inquiry_id is null or p_expected_version is null or p_expected_version < 1
    or p_correlation_id is null then
    raise exception 'CS_INVALID_REQUEST' using errcode = '22023';
  end if;

  select * into v_inquiry
  from public.cs_inquiries
  where id = p_inquiry_id
  for update;

  if not found then
    raise exception 'CS_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inquiry.version <> p_expected_version then
    raise exception 'CS_STALE_VERSION' using errcode = '40001';
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.cs_inquiries
  set status = 'resolved',
    version = version + 1,
    updated_at = v_now
  where id = p_inquiry_id;

  insert into public.audit_logs(
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    entity_id, correlation_id, before_after_summary
  ) values (
    p_app_user_id, p_admin_allowlist_id, 'cs.inquiry.resolve', 'cs_inquiry',
    p_inquiry_id::text, p_correlation_id,
    jsonb_build_object(
      'statusBefore', v_inquiry.status,
      'statusAfter', 'resolved',
      'versionBefore', v_inquiry.version,
      'versionAfter', v_inquiry.version + 1
    )
  );

  return jsonb_build_object('resolved', true);
end $$;

revoke all on function public.cs_list(uuid,uuid,text,timestamptz,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cs_read(uuid,uuid,uuid,timestamptz,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cs_create(uuid,text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cs_post(uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cs_resolve(uuid,uuid,uuid,integer,uuid) from public, anon, authenticated, service_role;

grant execute on function public.cs_list(uuid,uuid,text,timestamptz,uuid) to service_role;
grant execute on function public.cs_read(uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.cs_create(uuid,text,text,text,uuid) to service_role;
grant execute on function public.cs_post(uuid,uuid,text,uuid,uuid,uuid) to service_role;
grant execute on function public.cs_resolve(uuid,uuid,uuid,integer,uuid) to service_role;
