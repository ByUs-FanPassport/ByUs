create table public.community_stamp_share_links (
  id uuid primary key default extensions.gen_random_uuid(),
  token text not null unique,
  owner_app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  fan_passport_id uuid not null references public.fan_passports(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(owner_app_user_id,celebrity_id),
  constraint community_stamp_share_link_passport_owner
    foreign key(fan_passport_id,owner_app_user_id,celebrity_id)
    references public.fan_passports(id,app_user_id,celebrity_id) on delete restrict,
  constraint community_stamp_share_token_format check (token ~ '^[a-f0-9]{32}$')
);

create table public.community_stamp_share_visits (
  id uuid primary key default extensions.gen_random_uuid(),
  share_link_id uuid not null references public.community_stamp_share_links(id) on delete restrict,
  visitor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  visited_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(share_link_id,visitor_app_user_id)
);
create index community_stamp_share_visits_visitor_idx
  on public.community_stamp_share_visits(visitor_app_user_id,visited_at,id);

alter table public.community_stamp_share_links enable row level security;
alter table public.community_stamp_share_links force row level security;
alter table public.community_stamp_share_visits enable row level security;
alter table public.community_stamp_share_visits force row level security;
revoke all on table public.community_stamp_share_links,
  public.community_stamp_share_visits from public,anon,authenticated,service_role;

create function public.reject_community_stamp_share_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'community stamp share evidence is immutable';
end $$;
create trigger community_stamp_share_links_immutable
before update or delete on public.community_stamp_share_links for each row
execute function public.reject_community_stamp_share_mutation();
create trigger community_stamp_share_visits_immutable
before update or delete on public.community_stamp_share_visits for each row
execute function public.reject_community_stamp_share_mutation();

create or replace function public.assert_community_stamp_source(
  p_app_user_id uuid,
  p_celebrity_id uuid,
  p_kind public.community_stamp_kind,
  p_source_key text
) returns void language plpgsql stable set search_path='' as $$
declare
  v_source_kind text;
  v_source_id uuid;
  v_role text;
  v_expected text;
begin
  if p_kind='welcome' then
    if p_celebrity_id is not null or p_source_key<>'welcome:'||p_app_user_id::text then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='daily_checkin' then
    v_expected:='daily-checkin:'||p_celebrity_id::text||':'||public.community_stamp_kst_date()::text;
    if p_celebrity_id is null or p_source_key<>v_expected then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='first_comment' then
    v_source_kind:=pg_catalog.split_part(p_source_key,':',2);
    if p_source_key !~ '^first-comment:(lounge|notice):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',3)::uuid;
    select source_key into v_expected from (
      select 'first-comment:lounge:'||message.id::text source_key,message.created_at,message.id
      from public.fan_lounge_messages message
      where message.app_user_id=p_app_user_id and message.celebrity_id=p_celebrity_id
      union all
      select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
    ) comments order by created_at,id,source_key limit 1;
    if p_celebrity_id is null or v_expected is distinct from p_source_key
      or (v_source_kind='lounge' and not exists(
        select 1 from public.fan_lounge_messages message
        where message.id=v_source_id and message.app_user_id=p_app_user_id
          and message.celebrity_id=p_celebrity_id))
      or (v_source_kind='notice' and not exists(
        select 1 from public.celebrity_notice_comments comment
        join public.celebrity_notices notice on notice.id=comment.notice_id
        where comment.id=v_source_id and comment.app_user_id=p_app_user_id
          and notice.celebrity_id=p_celebrity_id)) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='invite' then
    if p_source_key !~ '^invite:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(inviter|invitee)$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',2)::uuid;
    v_role:=pg_catalog.split_part(p_source_key,':',3);
    if p_celebrity_id is not null or not exists(
      select 1 from public.community_stamp_invite_redemptions redemption
      where redemption.id=v_source_id
        and ((v_role='inviter' and redemption.inviter_app_user_id=p_app_user_id)
          or (v_role='invitee' and redemption.invitee_app_user_id=p_app_user_id))
    ) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='share' then
    if p_source_key !~ '^verified-share-visit:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',2)::uuid;
    if p_celebrity_id is null or not exists(
      select 1 from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      join public.app_users owner on owner.id=link.owner_app_user_id
      join public.fan_passports passport on passport.id=link.fan_passport_id
      where visit.id=v_source_id and link.owner_app_user_id=p_app_user_id
        and link.celebrity_id=p_celebrity_id
        and visit.visitor_app_user_id<>link.owner_app_user_id
        and owner.status='active'
        and passport.app_user_id=link.owner_app_user_id
        and passport.celebrity_id=link.celebrity_id
        and passport.business_status='issued'
    ) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  else
    -- Provider-backed subscription and support rewards remain closed until
    -- their trusted evidence integrations are available.
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001';
  end if;
end $$;

create or replace function public.issue_community_stamp(
  p_app_user_id uuid,
  p_celebrity_id uuid,
  p_kind public.community_stamp_kind,
  p_source_key text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_recipient text;
  v_celebrity_slug text;
  v_stamp_id uuid:=extensions.gen_random_uuid();
  v_job_id uuid:=extensions.gen_random_uuid();
  v_operation_key text;
begin
  if p_app_user_id is null or p_kind is null or p_source_key is null then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  if p_kind in ('subscription','support') then
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001';
  end if;
  perform 1 from public.app_users app_user
    where app_user.id=p_app_user_id and app_user.status='active' for key share;
  if not found then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  select wallet.address into v_recipient from public.user_wallets wallet
    where wallet.app_user_id=p_app_user_id and wallet.chain_id=91342
      and wallet.provider='privy' and wallet.wallet_type='embedded' for key share;
  if v_recipient is null then
    raise exception 'COMMUNITY_STAMP_WALLET_NOT_READY' using errcode='P0001';
  end if;
  if p_celebrity_id is not null then
    select celebrity.slug into v_celebrity_slug from public.celebrities celebrity
      where celebrity.id=p_celebrity_id and celebrity.status='published'
        and celebrity.archived_at is null for key share;
    if v_celebrity_slug is null then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
    end if;
  end if;
  perform public.assert_community_stamp_source(
    p_app_user_id,p_celebrity_id,p_kind,p_source_key);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'community-stamp:'||p_app_user_id::text||':'||p_kind::text||':'
      ||coalesce(p_celebrity_id::text,'global')||':'||p_source_key,0));
  if exists(select 1 from public.community_stamps stamp
    where stamp.app_user_id=p_app_user_id and stamp.kind=p_kind and
      (stamp.source_key=p_source_key
        or (p_kind in ('welcome','invite') and stamp.celebrity_id is null)
        or (p_kind in ('first_comment','subscription','support','share')
          and stamp.celebrity_id=p_celebrity_id))) then
    return false;
  end if;
  v_operation_key:='byus:community-stamp:v1:'||v_stamp_id::text;
  insert into public.blockchain_jobs(
    id,entity_type,entity_id,operation_key,payload_version,payload)
  values(v_job_id,'community_stamp',v_stamp_id,v_operation_key,1,jsonb_build_object(
    'recipient',v_recipient,
    'issuanceId','0x'||encode(extensions.digest(v_operation_key,'sha256'),'hex'),
    'stampKind',p_kind::text,
    'celebritySlug',v_celebrity_slug));
  insert into public.community_stamps(
    id,app_user_id,celebrity_id,kind,source_key,issued_at,blockchain_job_id)
  values(v_stamp_id,p_app_user_id,p_celebrity_id,p_kind,p_source_key,
    pg_catalog.statement_timestamp(),v_job_id);
  return true;
exception when unique_violation then
  return false;
end $$;

create function public.create_community_stamp_share_link(
  p_app_user_id uuid,p_celebrity_slug text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_celebrity_id uuid;
  v_passport_id uuid;
  v_token text;
begin
  if p_app_user_id is null or p_celebrity_slug is null
    or p_celebrity_slug<>pg_catalog.btrim(p_celebrity_slug) then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  perform 1 from public.app_users app_user
    where app_user.id=p_app_user_id and app_user.status='active' for key share;
  if not found then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  select celebrity.id into v_celebrity_id from public.celebrities celebrity
    where celebrity.slug=p_celebrity_slug and celebrity.status='published'
      and celebrity.archived_at is null for key share;
  if v_celebrity_id is null then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  select passport.id into v_passport_id from public.fan_passports passport
    where passport.app_user_id=p_app_user_id and passport.celebrity_id=v_celebrity_id
      and passport.business_status='issued' for key share;
  if v_passport_id is null then
    raise exception 'COMMUNITY_STAMP_PASSPORT_REQUIRED' using errcode='P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'community-stamp:share-link:'||p_app_user_id::text||':'||v_celebrity_id::text,0));
  select link.token into v_token from public.community_stamp_share_links link
    where link.owner_app_user_id=p_app_user_id and link.celebrity_id=v_celebrity_id;
  while v_token is null loop
    v_token:=encode(extensions.gen_random_bytes(16),'hex');
    insert into public.community_stamp_share_links(
      token,owner_app_user_id,celebrity_id,fan_passport_id)
    values(v_token,p_app_user_id,v_celebrity_id,v_passport_id)
    on conflict(token) do nothing;
    if not found then v_token:=null; end if;
  end loop;
  return jsonb_build_object('token',v_token);
end $$;

create function public.resolve_community_stamp_share_link(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_creator_slug text;
begin
  if p_token is null or p_token<>pg_catalog.btrim(p_token)
    or p_token !~ '^[a-f0-9]{32}$' then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  select celebrity.slug into v_creator_slug
  from public.community_stamp_share_links link
  join public.celebrities celebrity on celebrity.id=link.celebrity_id
  where link.token=p_token and celebrity.status='published'
    and celebrity.archived_at is null;
  if v_creator_slug is null then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  return jsonb_build_object('creator',v_creator_slug);
end $$;

create function public.visit_community_stamp_share_link(
  p_app_user_id uuid,p_token text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_link_id uuid;
  v_owner_app_user_id uuid;
  v_celebrity_id uuid;
  v_creator_slug text;
  v_visit_id uuid:=extensions.gen_random_uuid();
  v_inserted boolean:=false;
begin
  if p_app_user_id is null or p_token is null or p_token<>pg_catalog.btrim(p_token)
    or p_token !~ '^[a-f0-9]{32}$' then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  perform 1 from public.app_users app_user
    where app_user.id=p_app_user_id and app_user.status='active' for key share;
  if not found then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  select link.id,link.owner_app_user_id,link.celebrity_id,celebrity.slug
    into v_link_id,v_owner_app_user_id,v_celebrity_id,v_creator_slug
  from public.community_stamp_share_links link
  join public.celebrities celebrity on celebrity.id=link.celebrity_id
  where link.token=p_token and celebrity.status='published'
    and celebrity.archived_at is null for key share of link,celebrity;
  if v_link_id is null then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  -- Opening, bot traffic and the owner's own click are read-only events.
  if p_app_user_id=v_owner_app_user_id then
    return jsonb_build_object('creator',v_creator_slug);
  end if;
  -- A stale or no-wallet sender link may still navigate to the public creator,
  -- but it cannot persist evidence or mint a reward.
  if not exists(select 1 from public.app_users app_user
      where app_user.id=v_owner_app_user_id and app_user.status='active')
    or not exists(select 1 from public.user_wallets wallet
      where wallet.app_user_id=v_owner_app_user_id and wallet.chain_id=91342
        and wallet.provider='privy' and wallet.wallet_type='embedded')
    or not exists(select 1 from public.fan_passports passport
      where passport.id=(select link.fan_passport_id
        from public.community_stamp_share_links link where link.id=v_link_id)
        and passport.app_user_id=v_owner_app_user_id
        and passport.celebrity_id=v_celebrity_id
        and passport.business_status='issued') then
    return jsonb_build_object('creator',v_creator_slug);
  end if;
  insert into public.community_stamp_share_visits(
    id,share_link_id,visitor_app_user_id)
  values(v_visit_id,v_link_id,p_app_user_id)
  on conflict(share_link_id,visitor_app_user_id) do nothing;
  v_inserted:=found;
  if v_inserted then
    perform public.issue_community_stamp(v_owner_app_user_id,v_celebrity_id,'share',
      'verified-share-visit:'||v_visit_id::text);
  end if;
  return jsonb_build_object('creator',v_creator_slug);
end $$;

revoke all on function public.reject_community_stamp_share_mutation(),
  public.create_community_stamp_share_link(uuid,text),
  public.resolve_community_stamp_share_link(text),
  public.visit_community_stamp_share_link(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_community_stamp_share_link(uuid,text),
  public.resolve_community_stamp_share_link(text),
  public.visit_community_stamp_share_link(uuid,text)
  to service_role;

comment on table public.community_stamp_share_links is
  'Private reusable share tokens bound to an issued passport owner and creator.';
comment on table public.community_stamp_share_visits is
  'Private immutable evidence of an authenticated non-owner favorite-page visit.';
