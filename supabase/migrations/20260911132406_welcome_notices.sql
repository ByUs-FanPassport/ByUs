-- One semantic welcome notice is created for every published, non-archived
-- creator. Existing editorial notices and operator-managed welcome state are
-- never rewritten by the bootstrap path.

alter table public.celebrity_notices
  add column notice_kind text not null default 'standard',
  add constraint celebrity_notices_kind_valid
    check (notice_kind in ('standard', 'welcome'));

create unique index celebrity_notices_one_welcome_per_creator_idx
  on public.celebrity_notices (celebrity_id)
  where notice_kind = 'welcome';

create function public.enforce_celebrity_notice_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.notice_kind is distinct from old.notice_kind then
    raise exception 'notice kind is immutable' using errcode = '23514';
  end if;
  if old.notice_kind = 'welcome'
     and new.celebrity_id is distinct from old.celebrity_id then
    raise exception 'welcome notice celebrity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger celebrity_notices_kind_immutable
before update of notice_kind, celebrity_id on public.celebrity_notices
for each row execute function public.enforce_celebrity_notice_kind_immutable();

create function public.ensure_celebrity_welcome_notice(p_celebrity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_celebrity public.celebrities%rowtype;
  v_name_ko text;
  v_name_en text;
  v_notice_id uuid;
  v_inserted_id uuid;
  v_slug text;
  v_force_unique_slug boolean := false;
begin
  select * into v_celebrity
  from public.celebrities
  where id = p_celebrity_id;

  if not found
     or v_celebrity.status <> 'published'
     or v_celebrity.archived_at is not null then
    return;
  end if;

  if exists (
    select 1 from public.celebrity_notices
    where celebrity_id = p_celebrity_id and notice_kind = 'welcome'
  ) then
    return;
  end if;

  select
    max(name) filter (where locale = 'ko'),
    max(name) filter (where locale = 'en')
  into v_name_ko, v_name_en
  from public.celebrity_localizations
  where celebrity_id = p_celebrity_id;

  -- Publication validation is deferred, so normal create/localize/publish
  -- transactions reach this point with both names available. Returning here
  -- keeps this trigger from making localization insert order more restrictive.
  if nullif(trim(v_name_ko), '') is null
     or nullif(trim(v_name_en), '') is null then
    return;
  end if;

  loop
    v_notice_id := extensions.gen_random_uuid();
    v_slug := case
      when v_force_unique_slug then 'welcome-byus-' || replace(v_notice_id::text, '-', '')
      when exists (
        select 1 from public.celebrity_notices
        where celebrity_id = p_celebrity_id and slug = 'welcome-byus'
      ) then 'welcome-byus-' || replace(v_notice_id::text, '-', '')
      else 'welcome-byus'
    end;
    v_inserted_id := null;

    begin
      insert into public.celebrity_notices (
        id, celebrity_id, slug, notice_kind, publication_status, pinned
      ) values (
        v_notice_id, p_celebrity_id, v_slug, 'welcome', 'draft', true
      )
      on conflict (celebrity_id) where notice_kind = 'welcome' do nothing
      returning id into v_inserted_id;
    exception when unique_violation then
      -- A concurrent/editorial row claimed the candidate slug. Its content is
      -- left untouched and the semantic welcome receives a fresh slug.
      if exists (
        select 1 from public.celebrity_notices
        where celebrity_id = p_celebrity_id and notice_kind = 'welcome'
      ) then
        return;
      end if;
      v_force_unique_slug := true;
      continue;
    end;

    exit;
  end loop;

  -- Another transaction may already have created the semantic welcome.
  if v_inserted_id is null then
    return;
  end if;

  insert into public.celebrity_notice_localizations (
    notice_id, locale, title, body_json
  ) values
  (
    v_notice_id,
    'ko',
    format('%s 팬페이지에 오신 걸 환영해요', v_name_ko),
    jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', format('여기는 %s님을 좋아하는 팬들이 소식을 확인하고, 함께한 순간을 기록하는 공간이에요.', v_name_ko))
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '팬 인증을 마치고 나만의 팬 패스포트를 만들어 보세요.')
        )),
        jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2), 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '어떤 순간에 팬이 되셨나요?')
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '처음 좋아하게 된 영상이나 기억을 댓글로 남겨주세요. 짧은 인사도 좋아요.')
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'ByUs 운영팀')
        ))
      )
    )
  ),
  (
    v_notice_id,
    'en',
    format('Welcome to %s''s fan page', v_name_en),
    jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', format('This is a place for fans of %s to catch up on news and keep a record of the moments they''ve shared.', v_name_en))
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'Complete fan verification to create your fan passport.')
        )),
        jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2), 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'What made you a fan?')
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'Share the video or memory that started it all in the comments. A quick hello is welcome too.')
        )),
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'The ByUs Team')
        ))
      )
    )
  );

  -- Publish only after both localizations exist. This also works when callers
  -- explicitly switch deferred constraints to immediate mode.
  update public.celebrity_notices
  set publication_status = 'published',
      published_at = now(),
      ever_published_at = now()
  where id = v_notice_id;

  insert into public.audit_logs (
    actor_app_user_id,
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary
  ) values (
    null,
    null,
    'notice.welcome.created',
    'celebrity_notice',
    v_notice_id::text,
    jsonb_build_object(
      'source', 'system',
      'celebrityId', p_celebrity_id,
      'noticeKind', 'welcome',
      'slug', v_slug
    )
  );
end;
$$;

create function public.ensure_celebrity_welcome_notice_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_celebrity_welcome_notice(new.id);
  return new;
end;
$$;

-- Deferred execution observes KO/EN localizations inserted later in the same
-- creator publication transaction and does not create partially localized copy.
create constraint trigger celebrities_ensure_welcome_notice
after insert or update on public.celebrities
deferrable initially deferred
for each row execute function public.ensure_celebrity_welcome_notice_trigger();

do $$
declare
  v_celebrity_id uuid;
begin
  for v_celebrity_id in
    select id from public.celebrities
    where status = 'published' and archived_at is null
    order by id
  loop
    perform public.ensure_celebrity_welcome_notice(v_celebrity_id);
  end loop;
end;
$$;

revoke all on function public.enforce_celebrity_notice_kind_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_celebrity_welcome_notice(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_celebrity_welcome_notice_trigger()
  from public, anon, authenticated, service_role;

comment on column public.celebrity_notices.notice_kind is
  'Immutable semantic notice kind. Exactly one creator-bound welcome may exist per creator, including hidden or archived rows.';
comment on function public.ensure_celebrity_welcome_notice(uuid) is
  'Internal idempotent bootstrap for operator-signed KO/EN creator welcome notices; not a client RPC.';
