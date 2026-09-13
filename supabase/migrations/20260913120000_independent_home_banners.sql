-- Independent, localized home hero banners. LIVE publication remains calendar-only.

create type public.home_banner_kind as enum ('regular_live', 'announcement');

create table public.home_banners (
  id uuid primary key default extensions.gen_random_uuid(),
  kind public.home_banner_kind not null,
  celebrity_id uuid references public.celebrities(id) on delete restrict,
  publication_status public.content_status not null default 'draft',
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_banners_regular_live_creator check (kind <> 'regular_live' or celebrity_id is not null)
);

create table public.home_banner_localizations (
  banner_id uuid not null references public.home_banners(id) on delete cascade,
  locale public.content_locale not null,
  title text not null default '',
  description text not null default '',
  cta_label text not null default '',
  href text not null default '',
  alt text not null default '',
  desktop_asset_id uuid references public.public_image_assets(id) on delete restrict,
  mobile_asset_id uuid references public.public_image_assets(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (banner_id, locale),
  constraint home_banner_title_length check (length(btrim(title)) <= 160),
  constraint home_banner_description_length check (length(btrim(description)) <= 600),
  constraint home_banner_cta_length check (length(btrim(cta_label)) <= 80),
  constraint home_banner_alt_length check (length(btrim(alt)) <= 300),
  constraint home_banner_href_length check (length(href) <= 2048),
  constraint home_banner_href_safe check (
    href = '' or (
      href !~ '[\\[:cntrl:][:space:]]'
      and href !~ '^//'
      and (
        (left(href,1)='/' and left(href,2)<>'//')
        or href ~ '^https://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]+)?([/?#].*)?$'
      )
    )
  )
);

create unique index home_banners_one_published_regular_live_per_creator
  on public.home_banners(celebrity_id)
  where kind = 'regular_live' and publication_status = 'published';
create index home_banners_published_order
  on public.home_banners(sort_order, id) where publication_status = 'published';

create trigger home_banners_set_updated_at before update on public.home_banners
for each row execute function public.set_updated_at();
create trigger home_banner_localizations_set_updated_at before update on public.home_banner_localizations
for each row execute function public.set_updated_at();

alter table public.home_banners enable row level security;
alter table public.home_banners force row level security;
alter table public.home_banner_localizations enable row level security;
alter table public.home_banner_localizations force row level security;
revoke all on public.home_banners, public.home_banner_localizations from public, anon, authenticated, service_role;

create function public.home_banner_asset_json(p_asset_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when a.id is null then null else jsonb_build_object(
    'id',a.id,'url',a.url,'width',a.width,'height',a.height,
    'mimeType',a.mime_type,'revision',a.revision
  ) end from (select 1) seed left join public.public_image_assets a on a.id=p_asset_id;
$$;

create function public.read_published_home_banners(p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'kind',b.kind,'celebrityId',b.celebrity_id,
    'title',l.title,'description',l.description,'ctaLabel',l.cta_label,
    'href',l.href,'alt',l.alt,
    'desktopImage',public.home_banner_asset_json(l.desktop_asset_id),
    'mobileImage',public.home_banner_asset_json(l.mobile_asset_id)
  ) order by b.sort_order,b.id),'[]'::jsonb)
  from public.home_banners b
  join public.home_banner_localizations l on l.banner_id=b.id and l.locale=p_locale
  where b.publication_status='published'
    and (b.kind<>'regular_live' or exists(select 1 from public.celebrities c where c.id=b.celebrity_id and c.status='published'))
    and length(btrim(l.title))>0 and length(btrim(l.cta_label))>0
    and length(btrim(l.alt))>0 and l.href<>'' and l.desktop_asset_id is not null;
$$;

create function public.get_admin_home_banner_manager(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'kind',b.kind,'celebrityId',b.celebrity_id,
      'publicationStatus',b.publication_status,'sortOrder',b.sort_order,'revision',b.revision,
      'localizations',jsonb_build_object(
        'ko',jsonb_build_object('title',ko.title,'description',ko.description,'ctaLabel',ko.cta_label,'href',ko.href,'alt',ko.alt,'desktopImage',public.home_banner_asset_json(ko.desktop_asset_id),'mobileImage',public.home_banner_asset_json(ko.mobile_asset_id)),
        'en',jsonb_build_object('title',en.title,'description',en.description,'ctaLabel',en.cta_label,'href',en.href,'alt',en.alt,'desktopImage',public.home_banner_asset_json(en.desktop_asset_id),'mobileImage',public.home_banner_asset_json(en.mobile_asset_id))
      )) order by b.sort_order,b.id) from public.home_banners b
      join public.home_banner_localizations ko on ko.banner_id=b.id and ko.locale='ko'
      join public.home_banner_localizations en on en.banner_id=b.id and en.locale='en'),'[]'::jsonb),
    'celebrities',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'nameKo',ko.name,'nameEn',en.name) order by c.display_order,c.id)
      from public.celebrities c join public.celebrity_localizations ko on ko.celebrity_id=c.id and ko.locale='ko'
      join public.celebrity_localizations en on en.celebrity_id=c.id and en.locale='en'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create function public.save_admin_home_banner(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_banner_id uuid,p_expected_revision integer,p_kind public.home_banner_kind,p_celebrity_id uuid,
  p_localizations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.home_banners; loc public.content_locale; payload jsonb; v_before jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home-banners',20260913));
  if p_localizations is null or jsonb_typeof(p_localizations)<>'object' or not (p_localizations ?& array['ko','en']) then raise exception 'invalid banner localizations'; end if;
  if p_kind='regular_live' and p_celebrity_id is null then raise exception 'celebrity required'; end if;
  if p_banner_id is null then
    if p_expected_revision is distinct from 0 then raise exception 'revision conflict'; end if;
    insert into public.home_banners(kind,celebrity_id,sort_order) values(p_kind,p_celebrity_id,coalesce((select max(sort_order)+1 from public.home_banners),0)) returning * into b;
  else
    select * into b from public.home_banners x where x.id=p_banner_id for update;
    if not found then raise exception 'banner not found'; end if;
    v_before:=to_jsonb(b);
    if b.revision is distinct from p_expected_revision then raise exception 'revision conflict'; end if;
    update public.home_banners set kind=p_kind,celebrity_id=p_celebrity_id,revision=revision+1 where id=p_banner_id returning * into b;
  end if;
  foreach loc in array array['ko','en']::public.content_locale[] loop
    payload:=p_localizations->(loc::text);
    insert into public.home_banner_localizations(banner_id,locale,title,description,cta_label,href,alt,desktop_asset_id,mobile_asset_id)
    values(b.id,loc,coalesce(payload->>'title',''),coalesce(payload->>'description',''),coalesce(payload->>'ctaLabel',''),coalesce(payload->>'href',''),coalesce(payload->>'alt',''),nullif(payload->>'desktopAssetId','')::uuid,nullif(payload->>'mobileAssetId','')::uuid)
    on conflict(banner_id,locale) do update set title=excluded.title,description=excluded.description,cta_label=excluded.cta_label,href=excluded.href,alt=excluded.alt,desktop_asset_id=excluded.desktop_asset_id,mobile_asset_id=excluded.mobile_asset_id;
  end loop;
  if b.publication_status='published' and exists(
    select 1 from public.home_banner_localizations l where l.banner_id=b.id
      and (length(btrim(l.title))=0 or length(btrim(l.cta_label))=0 or length(btrim(l.alt))=0 or l.href='' or l.desktop_asset_id is null)
  ) then raise exception 'banner publication incomplete'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'home_banner.saved','home_banner',b.id::text,jsonb_build_object('before',v_before,'after',to_jsonb(b)),p_correlation_id);
  return jsonb_build_object('id',b.id,'revision',b.revision);
end $$;

create function public.set_admin_home_banner_publication(
 p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_banner_id uuid,p_expected_revision integer,p_publication_status public.content_status
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.home_banners; missing text;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home-banners',20260913));
 select * into b from public.home_banners where id=p_banner_id for update;
 if not found then raise exception 'banner not found'; end if;
 if b.revision is distinct from p_expected_revision then raise exception 'revision conflict'; end if;
 if p_publication_status='published' then
   if b.kind='regular_live' and b.celebrity_id is null then raise exception 'celebrity required'; end if;
   select string_agg(l.locale::text,',') into missing from public.home_banner_localizations l
    where l.banner_id=b.id and (length(btrim(l.title))=0 or length(btrim(l.cta_label))=0 or length(btrim(l.alt))=0 or l.href='' or l.desktop_asset_id is null);
   if missing is not null or (select count(*) from public.home_banner_localizations where banner_id=b.id)<>2 then raise exception 'banner publication incomplete'; end if;
 end if;
 update public.home_banners set publication_status=p_publication_status,revision=revision+1 where id=b.id returning * into b;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
 values(p_actor_app_user_id,p_actor_admin_allowlist_id,'home_banner.publication_changed','home_banner',b.id::text,jsonb_build_object('publicationStatus',p_publication_status,'revision',b.revision),p_correlation_id);
 return jsonb_build_object('id',b.id,'revision',b.revision);
end $$;

create function public.reorder_admin_home_banners(
 p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer; matched integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home-banners',20260913));
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid reorder'; end if;
 n:=jsonb_array_length(p_items);
 if n<>(select count(*) from public.home_banners) then raise exception 'full reorder required'; end if;
 select count(*) into matched from public.home_banners b join jsonb_array_elements(p_items) with ordinality x(item,ord)
   on b.id=(x.item->>'id')::uuid and b.revision=(x.item->>'expectedRevision')::integer;
 if matched<>n or n<>(select count(distinct value->>'id') from jsonb_array_elements(p_items)) then raise exception 'revision conflict'; end if;
 with desired as (select (value->>'id')::uuid id,(ordinality-1)::integer sort_order from jsonb_array_elements(p_items) with ordinality)
 update public.home_banners b set sort_order=d.sort_order,revision=b.revision+1 from desired d where b.id=d.id;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
 values(p_actor_app_user_id,p_actor_admin_allowlist_id,'home_banner.reordered','home_banner','all',jsonb_build_object('count',n),p_correlation_id);
 return jsonb_build_object('updated',n);
end $$;

revoke all on function public.home_banner_asset_json(uuid),public.read_published_home_banners(public.content_locale),public.get_admin_home_banner_manager(uuid,uuid),public.save_admin_home_banner(uuid,uuid,uuid,uuid,integer,public.home_banner_kind,uuid,jsonb),public.set_admin_home_banner_publication(uuid,uuid,uuid,uuid,integer,public.content_status),public.reorder_admin_home_banners(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_published_home_banners(public.content_locale),public.get_admin_home_banner_manager(uuid,uuid),public.save_admin_home_banner(uuid,uuid,uuid,uuid,integer,public.home_banner_kind,uuid,jsonb),public.set_admin_home_banner_publication(uuid,uuid,uuid,uuid,integer,public.content_status),public.reorder_admin_home_banners(uuid,uuid,uuid,jsonb) to service_role;
