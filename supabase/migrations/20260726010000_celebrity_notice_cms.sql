-- Celebrity Notice CMS. Rich text is stored as validated Tiptap JSON and
-- public reads only expose published, localized content.

create table public.celebrity_notices (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  slug text not null,
  publication_status public.content_status not null default 'draft',
  pinned boolean not null default false,
  published_at timestamptz,
  ever_published_at timestamptz,
  archived_at timestamptz,
  archived_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  archive_reason text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (celebrity_id, slug),
  constraint celebrity_notices_slug_canonical check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint celebrity_notices_publication_shape check (
    (publication_status = 'draft' and published_at is null)
    or (publication_status = 'published' and published_at is not null)
  ),
  constraint celebrity_notices_archive_shape check (
    (archived_at is null and archived_by_admin_allowlist_id is null and archive_reason is null)
    or (archived_at is not null and archived_by_admin_allowlist_id is not null and length(trim(archive_reason)) >= 10)
  )
);

create table public.celebrity_notice_localizations (
  notice_id uuid not null references public.celebrity_notices(id) on delete cascade,
  locale public.content_locale not null,
  title text not null check (length(trim(title)) between 1 and 160),
  body_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notice_id, locale),
  constraint celebrity_notice_body_document check (
    jsonb_typeof(body_json) = 'object'
    and body_json->>'type' = 'doc'
    and jsonb_typeof(body_json->'content') = 'array'
  )
);

create index celebrity_notices_public_idx
  on public.celebrity_notices (celebrity_id, pinned desc, published_at desc, id desc)
  where publication_status = 'published' and archived_at is null;

create trigger celebrity_notices_set_updated_at before update on public.celebrity_notices
for each row execute function public.set_updated_at();
create trigger celebrity_notice_localizations_set_updated_at before update on public.celebrity_notice_localizations
for each row execute function public.set_updated_at();

create function public.assert_notice_publishable(p_notice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_notice public.celebrity_notices%rowtype;
begin
  select * into v_notice from public.celebrity_notices where id = p_notice_id;
  if not found or v_notice.publication_status <> 'published' then return; end if;
  if v_notice.archived_at is not null then raise exception 'archived notice cannot be published'; end if;
  if not exists (
    select 1 from public.celebrities
    where id = v_notice.celebrity_id and status = 'published' and archived_at is null
  ) then raise exception 'published notice requires a published celebrity'; end if;
  if (select count(*) from public.celebrity_notice_localizations where notice_id = p_notice_id) <> 2
     or exists (
       select 1 from unnest(enum_range(null::public.content_locale)) required(locale)
       where not exists (
         select 1 from public.celebrity_notice_localizations localization
         where localization.notice_id = p_notice_id and localization.locale = required.locale
           and length(trim(localization.title)) > 0
           and jsonb_array_length(localization.body_json->'content') > 0
       )
     ) then raise exception 'published notice requires complete ko and en localizations'; end if;
end $$;

create function public.validate_celebrity_notice_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.assert_notice_publishable(new.id);
  return new;
end $$;

create constraint trigger celebrity_notices_validate_publication
after insert or update on public.celebrity_notices deferrable initially deferred
for each row execute function public.validate_celebrity_notice_publication();

alter table public.celebrity_notices enable row level security;
alter table public.celebrity_notice_localizations enable row level security;
revoke all on public.celebrity_notices, public.celebrity_notice_localizations from public, anon, authenticated;
grant select, insert, update, delete on public.celebrity_notices, public.celebrity_notice_localizations to service_role;

create function public.save_admin_celebrity_notice(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_notice_id uuid,
  p_expected_revision integer,
  p_celebrity_id uuid,
  p_slug text,
  p_pinned boolean,
  p_title_ko text,
  p_body_ko jsonb,
  p_title_en text,
  p_body_en jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_notice_id, extensions.gen_random_uuid()); v_before jsonb; v_revision integer;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_notice_id is not null then
    select to_jsonb(n), n.revision into v_before, v_revision
    from public.celebrity_notices n where n.id=p_notice_id for update;
    if not found then raise exception 'notice not found'; end if;
    if v_before->>'archived_at' is not null or v_before->>'publication_status' <> 'draft' then
      raise exception 'notice is immutable';
    end if;
    if p_expected_revision is null or v_revision <> p_expected_revision then raise exception 'notice revision conflict'; end if;
    update public.celebrity_notices
      set celebrity_id=p_celebrity_id, slug=p_slug, pinned=p_pinned, revision=revision+1
      where id=v_id;
  else
    insert into public.celebrity_notices(id,celebrity_id,slug,pinned)
    values(v_id,p_celebrity_id,p_slug,p_pinned);
  end if;
  insert into public.celebrity_notice_localizations(notice_id,locale,title,body_json) values
    (v_id,'ko',trim(p_title_ko),p_body_ko),
    (v_id,'en',trim(p_title_en),p_body_en)
  on conflict(notice_id,locale) do update
    set title=excluded.title, body_json=excluded.body_json;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,case when p_notice_id is null then 'notice.created' else 'notice.updated' end,
    'celebrity_notice',v_id::text,p_correlation_id,
    jsonb_build_object('beforeStatus',v_before->>'publication_status','slug',p_slug,'celebrityId',p_celebrity_id,'pinned',p_pinned));
  return v_id;
end $$;

create function public.set_admin_celebrity_notice_state(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_notice_id uuid,
  p_expected_revision integer,
  p_action text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_revision integer;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select to_jsonb(n),n.revision into v_before,v_revision from public.celebrity_notices n where n.id=p_notice_id for update;
  if not found then raise exception 'notice not found'; end if;
  if p_expected_revision is null or v_revision<>p_expected_revision then raise exception 'notice revision conflict'; end if;
  if v_before->>'archived_at' is not null then raise exception 'notice archived'; end if;
  if p_action='publish' then
    update public.celebrity_notices set publication_status='published',published_at=now(),
      ever_published_at=coalesce(ever_published_at,now()),revision=revision+1 where id=p_notice_id;
  elsif p_action='unpublish' then
    update public.celebrity_notices set publication_status='draft',published_at=null,revision=revision+1 where id=p_notice_id;
  elsif p_action='archive' then
    if length(trim(coalesce(p_reason,'')))<10 then raise exception 'archive reason required'; end if;
    update public.celebrity_notices set publication_status='draft',published_at=null,archived_at=now(),
      archived_by_admin_allowlist_id=p_actor_admin_allowlist_id,archive_reason=trim(p_reason),revision=revision+1
      where id=p_notice_id;
  else raise exception 'invalid notice action'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'notice.'||p_action,'celebrity_notice',p_notice_id::text,p_correlation_id,
    jsonb_build_object('from',v_before->>'publication_status','reason',p_reason));
end $$;
