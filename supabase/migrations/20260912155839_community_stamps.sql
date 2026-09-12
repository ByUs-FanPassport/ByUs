-- Canonical community stamp ledger. This is intentionally separate from the
-- existing activity stamps, membership proofs, reactions and collectibles.
create type public.community_stamp_kind as enum (
  'welcome',
  'first_comment',
  'subscription',
  'support',
  'share',
  'invite',
  'daily_checkin'
);

alter table public.blockchain_jobs
  drop constraint blockchain_jobs_entity_type_check;
alter table public.blockchain_jobs
  add constraint blockchain_jobs_entity_type_check
  check (entity_type in ('passport','stamp','reaction','collectible','community_stamp'));

create table public.community_stamps (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid references public.celebrities(id) on delete restrict,
  kind public.community_stamp_kind not null,
  source_key text not null,
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  blockchain_job_id uuid not null unique references public.blockchain_jobs(id) on delete restrict,
  mint_status public.credential_mint_status not null default 'queued',
  tx_hash text,
  token_id numeric(78,0),
  constraint community_stamps_source_key_bounded
    check (length(source_key) between 1 and 220 and source_key=pg_catalog.btrim(source_key)),
  constraint community_stamps_scope
    check ((kind in ('welcome','invite') and celebrity_id is null)
      or (kind not in ('welcome','invite') and celebrity_id is not null)),
  constraint community_stamps_mint_result
    check ((mint_status='minted' and tx_hash is not null and token_id is not null)
      or (mint_status<>'minted' and tx_hash is null and token_id is null))
);
create unique index community_stamps_source_once
  on public.community_stamps(app_user_id,kind,source_key);
create unique index community_stamps_global_kind_once
  on public.community_stamps(app_user_id,kind)
  where kind in ('welcome','invite');
create unique index community_stamps_creator_kind_once
  on public.community_stamps(app_user_id,celebrity_id,kind)
  where kind in ('first_comment','subscription','support','share');
create unique index community_stamps_daily_once
  on public.community_stamps(app_user_id,celebrity_id,source_key)
  where kind='daily_checkin';
create index community_stamps_owned_read_idx
  on public.community_stamps(app_user_id,issued_at desc,id desc);

create table public.community_stamp_invite_codes (
  app_user_id uuid primary key references public.app_users(id) on delete restrict,
  code text not null unique,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(app_user_id,code),
  constraint community_stamp_invite_code_format check (code ~ '^[A-F0-9]{24}$')
);

create table public.community_stamp_invite_redemptions (
  id uuid primary key default extensions.gen_random_uuid(),
  inviter_app_user_id uuid not null references public.app_users(id) on delete restrict,
  invitee_app_user_id uuid not null unique references public.app_users(id) on delete restrict,
  invite_code text not null references public.community_stamp_invite_codes(code) on delete restrict,
  redeemed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint community_stamp_invite_code_owner
    foreign key(inviter_app_user_id,invite_code)
    references public.community_stamp_invite_codes(app_user_id,code) on delete restrict,
  constraint community_stamp_invite_distinct_users
    check (inviter_app_user_id<>invitee_app_user_id)
);
create index community_stamp_invite_redemptions_inviter_idx
  on public.community_stamp_invite_redemptions(inviter_app_user_id,redeemed_at,id);

alter table public.community_stamps enable row level security;
alter table public.community_stamps force row level security;
alter table public.community_stamp_invite_codes enable row level security;
alter table public.community_stamp_invite_codes force row level security;
alter table public.community_stamp_invite_redemptions enable row level security;
alter table public.community_stamp_invite_redemptions force row level security;
revoke all on table public.community_stamps,
  public.community_stamp_invite_codes,
  public.community_stamp_invite_redemptions
  from public,anon,authenticated,service_role;

create function public.community_stamp_kst_date(
  p_at timestamptz default pg_catalog.statement_timestamp()
) returns date language sql immutable set search_path='' as $$
  select (p_at at time zone 'Asia/Seoul')::date
$$;

create function public.assert_community_stamp_source(
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
      select 'first-comment:lounge:'||m.id::text source_key,m.created_at,m.id
      from public.fan_lounge_messages m
      where m.app_user_id=p_app_user_id and m.celebrity_id=p_celebrity_id
      union all
      select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
    ) comments order by created_at,id,source_key limit 1;
    if p_celebrity_id is null or v_expected is distinct from p_source_key
      or (v_source_kind='lounge' and not exists(
        select 1 from public.fan_lounge_messages m
        where m.id=v_source_id and m.app_user_id=p_app_user_id and m.celebrity_id=p_celebrity_id))
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
  else
    -- Share and provider-backed rewards remain closed until their trusted
    -- evidence integrations are available.
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001';
  end if;
end $$;

create function public.assert_community_stamp_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_job public.blockchain_jobs%rowtype;
  v_expected_status public.credential_mint_status;
  v_expected_payload jsonb;
begin
  if tg_op='INSERT' then
    if not exists(select 1 from public.app_users app_user
      where app_user.id=new.app_user_id and app_user.status='active') then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
    end if;
    if new.celebrity_id is not null and not exists(
      select 1 from public.celebrities celebrity
      where celebrity.id=new.celebrity_id and celebrity.status='published'
        and celebrity.archived_at is null) then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
    end if;
    perform public.assert_community_stamp_source(
      new.app_user_id,new.celebrity_id,new.kind,new.source_key);
  end if;
  select * into v_job from public.blockchain_jobs job
  where job.id=new.blockchain_job_id for key share;
  if not found or v_job.entity_type<>'community_stamp' or v_job.entity_id<>new.id
    or v_job.operation_key<>'byus:community-stamp:v1:'||new.id::text
    or v_job.payload_version<>1 then
    raise exception 'community stamp blockchain job link is invalid';
  end if;
  v_expected_payload:=jsonb_build_object(
    'recipient',(select wallet.address from public.user_wallets wallet
      where wallet.app_user_id=new.app_user_id and wallet.chain_id=91342
        and wallet.provider='privy' and wallet.wallet_type='embedded'),
    'issuanceId','0x'||encode(extensions.digest(v_job.operation_key,'sha256'),'hex'),
    'stampKind',new.kind::text,
    'celebritySlug',(select celebrity.slug from public.celebrities celebrity where celebrity.id=new.celebrity_id)
  );
  if (v_job.payload-'workerSubmission') is distinct from v_expected_payload
    or v_expected_payload->>'recipient' is null
    or coalesce(v_expected_payload->>'recipient','') !~ '^0x[0-9a-f]{40}$' then
    raise exception 'community stamp blockchain job payload is invalid';
  end if;
  v_expected_status:=case v_job.status
    when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.mint_status<>v_expected_status
    or (v_job.status='COMPLETED' and
      (new.tx_hash is distinct from v_job.tx_hash or new.token_id is distinct from v_job.token_id))
    or (v_job.status<>'COMPLETED' and (new.tx_hash is not null or new.token_id is not null)) then
    raise exception 'community stamp mint state does not match blockchain job';
  end if;
  return new;
end $$;

create function public.reject_community_stamp_business_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception 'community stamp ledger is immutable';
  end if;
  if new.id is distinct from old.id
    or new.app_user_id is distinct from old.app_user_id
    or new.celebrity_id is distinct from old.celebrity_id
    or new.kind is distinct from old.kind
    or new.source_key is distinct from old.source_key
    or new.issued_at is distinct from old.issued_at
    or new.blockchain_job_id is distinct from old.blockchain_job_id then
    raise exception 'community stamp ledger is immutable';
  end if;
  return new;
end $$;

create trigger community_stamps_validate_source
before insert on public.community_stamps for each row
execute function public.assert_community_stamp_blockchain_job_link();
create trigger community_stamps_validate_job_update
before update of mint_status,tx_hash,token_id on public.community_stamps for each row
execute function public.assert_community_stamp_blockchain_job_link();
create trigger community_stamps_business_immutable
before update or delete on public.community_stamps for each row
execute function public.reject_community_stamp_business_mutation();

create function public.reject_community_stamp_invite_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'community stamp invite records are immutable';
end $$;
create trigger community_stamp_invite_codes_immutable
before update or delete on public.community_stamp_invite_codes for each row
execute function public.reject_community_stamp_invite_mutation();
create trigger community_stamp_invite_redemptions_immutable
before update or delete on public.community_stamp_invite_redemptions for each row
execute function public.reject_community_stamp_invite_mutation();

create function public.issue_community_stamp(
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
  if p_kind in ('subscription','support','share') then
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

create function public.recover_first_comment_community_stamp(
  p_app_user_id uuid,p_celebrity_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_source_key text;
begin
  if exists(select 1 from public.community_stamps stamp
    where stamp.app_user_id=p_app_user_id and stamp.celebrity_id=p_celebrity_id
      and stamp.kind='first_comment') then return false; end if;
  if not exists(select 1 from public.celebrities celebrity
    where celebrity.id=p_celebrity_id and celebrity.status='published'
      and celebrity.archived_at is null) then return false; end if;
  select source_key into v_source_key from (
    select 'first-comment:lounge:'||message.id::text source_key,message.created_at,message.id
      from public.fan_lounge_messages message
      where message.app_user_id=p_app_user_id and message.celebrity_id=p_celebrity_id
    union all
    select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
  ) comments order by created_at,id,source_key limit 1;
  if v_source_key is null then return false; end if;
  return public.issue_community_stamp(
    p_app_user_id,p_celebrity_id,'first_comment',v_source_key);
end $$;

create function public.award_first_comment_community_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_celebrity_id uuid;
begin
  if tg_table_name='fan_lounge_messages' then
    v_celebrity_id:=new.celebrity_id;
  else
    select notice.celebrity_id into v_celebrity_id
      from public.celebrity_notices notice where notice.id=new.notice_id;
  end if;
  if exists(select 1 from public.app_users app_user
      where app_user.id=new.app_user_id and app_user.status='active')
    and exists(select 1 from public.user_wallets wallet
      where wallet.app_user_id=new.app_user_id and wallet.chain_id=91342
        and wallet.provider='privy' and wallet.wallet_type='embedded') then
    perform public.recover_first_comment_community_stamp(new.app_user_id,v_celebrity_id);
  end if;
  return new;
end $$;
create trigger fan_lounge_messages_award_first_comment
after insert on public.fan_lounge_messages for each row
execute function public.award_first_comment_community_stamp();
create trigger celebrity_notice_comments_award_first_comment
after insert on public.celebrity_notice_comments for each row
execute function public.award_first_comment_community_stamp();

create function public.claim_welcome_community_stamp(p_app_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_awarded boolean;v_creator record;
begin
  v_awarded:=public.issue_community_stamp(
    p_app_user_id,null,'welcome','welcome:'||p_app_user_id::text);
  for v_creator in
    select distinct owned_comments.creator_id from (
      select message.celebrity_id creator_id from public.fan_lounge_messages message
        where message.app_user_id=p_app_user_id
      union
      select notice.celebrity_id from public.celebrity_notice_comments comment
        join public.celebrity_notices notice on notice.id=comment.notice_id
        where comment.app_user_id=p_app_user_id
    ) owned_comments
    join public.celebrities celebrity on celebrity.id=owned_comments.creator_id
      and celebrity.status='published' and celebrity.archived_at is null
  loop
    perform public.recover_first_comment_community_stamp(
      p_app_user_id,v_creator.creator_id);
  end loop;
  return jsonb_build_object('awarded',v_awarded);
end $$;

create function public.award_welcome_community_stamp_on_wallet()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.chain_id=91342 and new.provider='privy' and new.wallet_type='embedded'
    and exists(select 1 from public.app_users app_user
      where app_user.id=new.app_user_id and app_user.status='active') then
    perform public.claim_welcome_community_stamp(new.app_user_id);
  end if;
  return new;
end $$;
create trigger user_wallets_award_welcome_community_stamp
after insert on public.user_wallets for each row
execute function public.award_welcome_community_stamp_on_wallet();

create function public.get_owned_community_stamps(
  p_app_user_id uuid,p_celebrity_slug text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_celebrity_id uuid;v_result jsonb;
begin
  if not exists(select 1 from public.app_users app_user
    where app_user.id=p_app_user_id and app_user.status='active') then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  if p_celebrity_slug is not null then
    select celebrity.id into v_celebrity_id from public.celebrities celebrity
      where celebrity.slug=p_celebrity_slug and celebrity.status='published'
        and celebrity.archived_at is null;
    if v_celebrity_id is null then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
    end if;
  end if;
  select jsonb_build_object(
    'stamps',coalesce(jsonb_agg(jsonb_build_object(
      'id',stamp.id,
      'kind',stamp.kind,
      'celebritySlug',celebrity.slug,
      'issuedAt',stamp.issued_at,
      'mint',jsonb_build_object(
        'status',stamp.mint_status,
        'txHash',stamp.tx_hash,
        'tokenId',stamp.token_id::text)
    ) order by stamp.issued_at,stamp.id),'[]'::jsonb),
    'today',public.community_stamp_kst_date()::text)
  into v_result from public.community_stamps stamp
  left join public.celebrities celebrity on celebrity.id=stamp.celebrity_id
  where stamp.app_user_id=p_app_user_id
    and (p_celebrity_slug is null or stamp.celebrity_id is null
      or stamp.celebrity_id=v_celebrity_id);
  return v_result;
end $$;

create function public.check_in_community_stamp(
  p_app_user_id uuid,p_celebrity_slug text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_celebrity_id uuid;v_awarded boolean;v_today date;
begin
  if p_celebrity_slug is null or p_celebrity_slug<>pg_catalog.btrim(p_celebrity_slug) then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  select celebrity.id into v_celebrity_id from public.celebrities celebrity
    where celebrity.slug=p_celebrity_slug and celebrity.status='published'
      and celebrity.archived_at is null for key share;
  if v_celebrity_id is null then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  v_today:=public.community_stamp_kst_date();
  v_awarded:=public.issue_community_stamp(p_app_user_id,v_celebrity_id,
    'daily_checkin','daily-checkin:'||v_celebrity_id::text||':'||v_today::text);
  return jsonb_build_object('awarded',v_awarded);
end $$;

create function public.get_community_stamp_invite_code(p_app_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text;v_redeemed boolean;
begin
  perform 1 from public.app_users app_user
    where app_user.id=p_app_user_id and app_user.status='active' for key share;
  if not found then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'community-stamp:invite-code:'||p_app_user_id::text,0));
  select code into v_code from public.community_stamp_invite_codes
    where app_user_id=p_app_user_id;
  while v_code is null loop
    v_code:=upper(encode(extensions.gen_random_bytes(12),'hex'));
    insert into public.community_stamp_invite_codes(app_user_id,code)
      values(p_app_user_id,v_code) on conflict(code) do nothing;
    if not found then v_code:=null; end if;
  end loop;
  select exists(select 1 from public.community_stamp_invite_redemptions redemption
    where redemption.invitee_app_user_id=p_app_user_id) into v_redeemed;
  return jsonb_build_object('code',v_code,'redeemed',v_redeemed);
end $$;

create function public.redeem_community_stamp_invite(
  p_app_user_id uuid,p_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_code text:=upper(pg_catalog.btrim(coalesce(p_code,'')));
  v_inviter uuid;
  v_redemption_id uuid:=extensions.gen_random_uuid();
  v_awarded boolean;
begin
  if v_code !~ '^[A-F0-9]{24}$' then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
  end if;
  select code.app_user_id into v_inviter from public.community_stamp_invite_codes code
    where code.code=v_code;
  if v_inviter is null then
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001';
  end if;
  if v_inviter=p_app_user_id then
    raise exception 'COMMUNITY_STAMP_SELF_INVITE' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'community-stamp:invite-user:'||least(v_inviter::text,p_app_user_id::text),0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'community-stamp:invite-user:'||greatest(v_inviter::text,p_app_user_id::text),0));
  perform 1 from public.app_users app_user
    where app_user.id in (v_inviter,p_app_user_id)
    order by app_user.id for update;
  if exists(select 1 from public.community_stamp_invite_redemptions redemption
    where redemption.invitee_app_user_id=p_app_user_id) then
    raise exception 'COMMUNITY_STAMP_ALREADY_REDEEMED' using errcode='23505';
  end if;
  if exists(select 1 from public.community_stamp_invite_redemptions redemption
    where redemption.inviter_app_user_id=p_app_user_id
      and redemption.invitee_app_user_id=v_inviter) then
    raise exception 'COMMUNITY_STAMP_ALREADY_REDEEMED' using errcode='23505';
  end if;
  if (select count(*) from public.app_users app_user
      where app_user.id in (p_app_user_id,v_inviter) and app_user.status='active')<>2 then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002';
  end if;
  if (select count(*) from public.user_wallets wallet
      where wallet.app_user_id in (p_app_user_id,v_inviter) and wallet.chain_id=91342
        and wallet.provider='privy' and wallet.wallet_type='embedded')<>2 then
    raise exception 'COMMUNITY_STAMP_WALLET_NOT_READY' using errcode='P0001';
  end if;
  insert into public.community_stamp_invite_redemptions(
    id,inviter_app_user_id,invitee_app_user_id,invite_code)
  values(v_redemption_id,v_inviter,p_app_user_id,v_code);
  perform public.issue_community_stamp(v_inviter,null,'invite',
    'invite:'||v_redemption_id::text||':inviter');
  v_awarded:=public.issue_community_stamp(p_app_user_id,null,'invite',
    'invite:'||v_redemption_id::text||':invitee');
  return jsonb_build_object('awarded',v_awarded);
end $$;

-- Include community stamps only for workers that explicitly advertise the new
-- capability. The legacy three-argument claim remains limited to the original
-- passport, stamp and reaction entities.
create or replace function public.claim_blockchain_jobs(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_entity_types text[]
) returns setof public.blockchain_jobs language plpgsql security definer set search_path='' as $$
begin
  if p_worker_id is null or length(pg_catalog.btrim(p_worker_id))=0 then
    raise exception 'worker id is required'; end if;
  if p_batch_size<1 or p_batch_size>100 then
    raise exception 'batch size must be between 1 and 100'; end if;
  if p_lease_seconds<30 or p_lease_seconds>900 then
    raise exception 'lease seconds must be between 30 and 900'; end if;
  if p_entity_types is null or pg_catalog.cardinality(p_entity_types)=0
    or exists(select 1 from pg_catalog.unnest(p_entity_types) kind
      where kind not in ('passport','stamp','reaction','collectible','community_stamp')) then
    raise exception 'supported entity types are invalid';
  end if;
  return query with candidates as (
    select id from public.blockchain_jobs
    where status in ('PENDING','RETRYING') and next_attempt_at<=pg_catalog.now()
      and attempts<max_attempts and entity_type=any(p_entity_types)
    order by next_attempt_at,created_at for update skip locked limit p_batch_size
  ) update public.blockchain_jobs jobs set
    status='PROCESSING',attempts=jobs.attempts+1,lease_owner=p_worker_id,
    lease_expires_at=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),
    last_error_code=null,last_error_message=null
  from candidates where jobs.id=candidates.id returning jobs.*;
end $$;

create or replace function public.enforce_linked_blockchain_job_immutability()
returns trigger language plpgsql set search_path='' as $$
declare is_linked boolean;worker_submission_key_count integer;
begin
  select exists(
    select 1 from public.fan_passports where blockchain_job_id=old.id union all
    select 1 from public.stamps where blockchain_job_id=old.id union all
    select 1 from public.fan_reactions where blockchain_job_id=old.id union all
    select 1 from public.live_collectible_claims where blockchain_job_id=old.id union all
    select 1 from public.community_stamps where blockchain_job_id=old.id
  ) into is_linked;
  if not is_linked then return new; end if;
  if new.entity_type is distinct from old.entity_type
    or new.entity_id is distinct from old.entity_id
    or new.operation_key is distinct from old.operation_key
    or new.payload_version is distinct from old.payload_version
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'linked blockchain job business identity is immutable'; end if;
  if new.payload ? 'workerSubmission'
    and new.tx_hash is distinct from new.payload->'workerSubmission'->>'txHash' then
    raise exception 'linked blockchain job transaction hash conflicts with prepared submission'; end if;
  if new.payload=old.payload then return new; end if;
  if old.payload ? 'workerSubmission' or not(new.payload ? 'workerSubmission')
    or new.payload-'workerSubmission'<>old.payload
    or jsonb_typeof(new.payload->'workerSubmission')<>'object' then
    raise exception 'linked blockchain job payload is immutable'; end if;
  select count(*) into worker_submission_key_count
    from jsonb_object_keys(new.payload->'workerSubmission');
  if worker_submission_key_count<>2
    or not((new.payload->'workerSubmission') ?& array['txHash','signedTransaction'])
    or coalesce(new.payload->'workerSubmission'->>'txHash','') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(new.payload->'workerSubmission'->>'signedTransaction','') !~ '^0x[0-9a-fA-F]+$'
    or length(coalesce(new.payload->'workerSubmission'->>'signedTransaction',''))>262144
    or new.payload->'workerSubmission'->>'txHash' is distinct from new.tx_hash then
    raise exception 'linked blockchain job payload is immutable'; end if;
  return new;
end $$;

create or replace function public.reconcile_credential_from_blockchain_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_expected public.credential_mint_status;v_linked_count integer;v_affected integer;
begin
  select
    (select count(*) from public.fan_passports where blockchain_job_id=new.id)
    +(select count(*) from public.stamps where blockchain_job_id=new.id)
    +(select count(*) from public.fan_reactions where blockchain_job_id=new.id)
    +(select count(*) from public.live_collectible_claims where blockchain_job_id=new.id)
    +(select count(*) from public.community_stamps where blockchain_job_id=new.id)
    into v_linked_count;
  if v_linked_count=0 then return new; end if;
  if v_linked_count<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  v_expected:=case new.status
    when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.entity_type='passport' then
    update public.fan_passports set mint_status=v_expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='stamp' then
    update public.stamps set mint_status=v_expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='reaction' then
    update public.fan_reactions set mint_status=v_expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='collectible' then
    update public.live_collectible_claims set mint_status=v_expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='community_stamp' then
    update public.community_stamps set mint_status=v_expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  end if;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  return new;
end $$;

-- Preserve identity semantics while making welcome issuance/recovery part of
-- every successful session sync.
create or replace function public.sync_privy_identity(
  p_privy_user_id text,p_verified_email text,p_chain_id bigint,p_wallet_address text
) returns table(app_user_id uuid,wallet_id uuid)
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_user public.app_users%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_existing_owner uuid;
begin
  p_privy_user_id:=trim(p_privy_user_id);
  p_verified_email:=lower(trim(p_verified_email));
  p_wallet_address:=lower(trim(p_wallet_address));
  if p_privy_user_id='' then raise exception 'invalid privy user id' using errcode='22023'; end if;
  if p_verified_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid verified email' using errcode='22023'; end if;
  if p_chain_id<=0 or p_wallet_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid wallet' using errcode='22023'; end if;
  insert into public.app_users(privy_user_id,verified_email,last_authenticated_at)
    values(p_privy_user_id,p_verified_email,now())
    on conflict(privy_user_id) do update set
      verified_email=excluded.verified_email,last_authenticated_at=excluded.last_authenticated_at
    returning * into v_user;
  if v_user.status<>'active' then raise exception 'user disabled' using errcode='42501'; end if;
  select wallet.app_user_id into v_existing_owner from public.user_wallets wallet
    where wallet.chain_id=p_chain_id and wallet.address=p_wallet_address;
  if v_existing_owner is not null and v_existing_owner<>v_user.id then
    raise exception 'wallet already linked' using errcode='23505'; end if;
  select * into v_wallet from public.user_wallets wallet
    where wallet.app_user_id=v_user.id and wallet.chain_id=p_chain_id for update;
  if found and v_wallet.address<>p_wallet_address then
    raise exception 'wallet relink requires review' using errcode='23514'; end if;
  insert into public.user_wallets(app_user_id,chain_id,address)
    values(v_user.id,p_chain_id,p_wallet_address)
    on conflict on constraint user_wallets_one_wallet_per_user_chain do update
      set updated_at=public.user_wallets.updated_at returning * into v_wallet;
  if p_chain_id=91342 then perform public.claim_welcome_community_stamp(v_user.id); end if;
  return query select v_user.id,v_wallet.id;
end $$;

revoke all on function public.community_stamp_kst_date(timestamptz),
  public.assert_community_stamp_source(uuid,uuid,public.community_stamp_kind,text),
  public.assert_community_stamp_blockchain_job_link(),
  public.reject_community_stamp_business_mutation(),
  public.reject_community_stamp_invite_mutation(),
  public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text),
  public.recover_first_comment_community_stamp(uuid,uuid),
  public.award_first_comment_community_stamp(),
  public.award_welcome_community_stamp_on_wallet()
  from public,anon,authenticated,service_role;
revoke all on function public.get_owned_community_stamps(uuid,text),
  public.claim_welcome_community_stamp(uuid),
  public.check_in_community_stamp(uuid,text),
  public.get_community_stamp_invite_code(uuid),
  public.redeem_community_stamp_invite(uuid,text),
  public.claim_blockchain_jobs(text,integer,integer,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.get_owned_community_stamps(uuid,text),
  public.claim_welcome_community_stamp(uuid),
  public.check_in_community_stamp(uuid,text),
  public.get_community_stamp_invite_code(uuid),
  public.redeem_community_stamp_invite(uuid,text),
  public.claim_blockchain_jobs(text,integer,integer,text[])
  to service_role;

comment on table public.community_stamps is
  'Private immutable ledger for the seven community stamp kinds and their mint queue state.';
comment on function public.claim_blockchain_jobs(text,integer,integer,text[]) is
  'Claims only explicitly advertised entity capabilities; community_stamp requires an upgraded worker.';
