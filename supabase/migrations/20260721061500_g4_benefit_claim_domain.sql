-- G4 benefit catalog and atomic delivery foundation. Delivery material is kept
-- out of public catalog rows and is only returned to the owning claimant.

create type public.benefit_delivery_type as enum (
  'text', 'external_link', 'shared_code', 'unique_code'
);

create table public.benefits (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  publication_status public.content_status not null default 'draft',
  delivery_type public.benefit_delivery_type not null,
  claim_opens_at timestamptz not null,
  claim_closes_at timestamptz not null,
  stock_limit integer check (stock_limit is null or stock_limit > 0),
  per_user_limit integer not null default 1 check (per_user_limit between 1 and 100),
  minimum_score integer not null default 0 check (minimum_score >= 0),
  minimum_level text not null default 'Bronze'
    check (minimum_level in ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond')),
  required_stamp_type text
    check (required_stamp_type is null or required_stamp_type in (
      'knowledge', 'reservation', 'attendance', 'survey'
    )),
  required_activity_type public.fan_activity_type,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benefits_slug_canonical
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint benefits_claim_window_ordered
    check (claim_opens_at < claim_closes_at),
  constraint benefits_publication_timestamp check (
    (publication_status = 'draft' and published_at is null)
    or (publication_status = 'published' and published_at is not null)
  )
);

create table public.benefit_localizations (
  benefit_id uuid not null references public.benefits(id) on delete cascade,
  locale public.content_locale not null,
  title text not null check (length(trim(title)) between 1 and 160),
  summary text not null check (length(trim(summary)) between 1 and 1200),
  eligibility_label text not null
    check (length(trim(eligibility_label)) between 1 and 300),
  delivery_label text not null
    check (length(trim(delivery_label)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (benefit_id, locale)
);

-- One private delivery row exists for non-unique delivery types. The public
-- catalog RPC never reads this table.
create table public.benefit_delivery_vault (
  benefit_id uuid primary key references public.benefits(id) on delete restrict,
  delivery_type public.benefit_delivery_type not null,
  secret_value text not null check (length(secret_value) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benefit_delivery_vault_non_unique
    check (delivery_type in ('text', 'external_link', 'shared_code')),
  constraint benefit_delivery_vault_external_url check (
    delivery_type <> 'external_link'
    or (
      secret_value = trim(secret_value)
      and secret_value !~ '[@[:space:]]'
      and secret_value ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/[^[:space:]]+$'
    )
  )
);

create table public.benefit_unique_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  code_value text not null check (length(trim(code_value)) between 1 and 500),
  claimed_by_claim_id uuid,
  created_at timestamptz not null default now(),
  unique (benefit_id, code_value),
  unique (id, benefit_id)
);

create table public.benefit_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  passport_id uuid not null,
  idempotency_key uuid not null unique,
  delivery_type public.benefit_delivery_type not null,
  unique_code_id uuid,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, benefit_id),
  constraint benefit_claims_passport_owner_fk
    foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports (id, app_user_id, celebrity_id) on delete restrict,
  constraint benefit_claims_unique_code_shape check (
    (delivery_type = 'unique_code' and unique_code_id is not null)
    or (delivery_type <> 'unique_code' and unique_code_id is null)
  ),
  constraint benefit_claims_unique_code_fk
    foreign key (unique_code_id, benefit_id)
    references public.benefit_unique_codes (id, benefit_id) on delete restrict
);

alter table public.benefit_unique_codes
  add constraint benefit_unique_codes_claim_fk
  foreign key (claimed_by_claim_id, benefit_id)
  references public.benefit_claims (id, benefit_id) on delete restrict;

create unique index benefit_unique_codes_claim_once_idx
  on public.benefit_unique_codes (claimed_by_claim_id)
  where claimed_by_claim_id is not null;
create index benefit_claims_benefit_count_idx
  on public.benefit_claims (benefit_id, claimed_at, id);
create index benefit_claims_owner_idx
  on public.benefit_claims (app_user_id, claimed_at desc, id desc);
create index benefit_unique_codes_available_idx
  on public.benefit_unique_codes (benefit_id, created_at, id)
  where claimed_by_claim_id is null;

create table public.benefit_claim_audits (
  id bigint generated always as identity primary key,
  benefit_claim_id uuid not null references public.benefit_claims(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  event_type text not null check (event_type = 'claimed'),
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create function public.reject_benefit_claim_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'benefit claim audit is append-only';
end;
$$;

create trigger benefit_claim_audits_reject_update_delete
before update or delete on public.benefit_claim_audits
for each row execute function public.reject_benefit_claim_audit_mutation();

create trigger benefits_set_updated_at before update on public.benefits
for each row execute function public.set_updated_at();
create trigger benefit_localizations_set_updated_at
before update on public.benefit_localizations
for each row execute function public.set_updated_at();
create trigger benefit_delivery_vault_set_updated_at
before update on public.benefit_delivery_vault
for each row execute function public.set_updated_at();

create function public.prepare_benefit_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.publication_status = 'published' and old.publication_status = 'draft' then
    new.published_at := now();
  elsif new.publication_status = 'draft' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger benefits_prepare_publication
before update of publication_status on public.benefits
for each row execute function public.prepare_benefit_publication();

create function public.assert_benefit_publishable(p_benefit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_benefit public.benefits%rowtype;
begin
  select * into v_benefit from public.benefits where id = p_benefit_id;
  if not found or v_benefit.publication_status <> 'published' then return; end if;
  if not exists (select 1 from public.celebrities where id = v_benefit.celebrity_id and status = 'published') then
    raise exception 'published benefit requires a published celebrity';
  end if;
  if (select count(*) from public.benefit_localizations where benefit_id = p_benefit_id) <> 2
     or exists (
       select 1 from unnest(enum_range(null::public.content_locale)) required(locale)
       where not exists (
         select 1 from public.benefit_localizations localization
         where localization.benefit_id = p_benefit_id and localization.locale = required.locale
       )
     ) then
    raise exception 'published benefit requires complete ko and en localizations';
  end if;
  if v_benefit.delivery_type = 'unique_code' then
    if exists (select 1 from public.benefit_delivery_vault where benefit_id = p_benefit_id)
       or not exists (select 1 from public.benefit_unique_codes where benefit_id = p_benefit_id) then
      raise exception 'published unique-code benefit requires code inventory only';
    end if;
  elsif not exists (
    select 1 from public.benefit_delivery_vault
    where benefit_id = p_benefit_id and delivery_type = v_benefit.delivery_type
  ) or exists (select 1 from public.benefit_unique_codes where benefit_id = p_benefit_id) then
    raise exception 'published benefit delivery configuration is invalid';
  end if;
end;
$$;

create function public.validate_benefit_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin perform public.assert_benefit_publishable(coalesce(new.id, old.id)); return coalesce(new, old); end;
$$;
create function public.validate_benefit_child_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin perform public.assert_benefit_publishable(coalesce(new.benefit_id, old.benefit_id)); return coalesce(new, old); end;
$$;

create constraint trigger benefits_validate_publication
after insert or update on public.benefits deferrable initially deferred
for each row execute function public.validate_benefit_publication_trigger();
create constraint trigger benefit_localizations_validate_publication
after insert or update or delete on public.benefit_localizations deferrable initially deferred
for each row execute function public.validate_benefit_child_trigger();
create constraint trigger benefit_delivery_vault_validate_publication
after insert or update or delete on public.benefit_delivery_vault deferrable initially deferred
for each row execute function public.validate_benefit_child_trigger();
create constraint trigger benefit_unique_codes_validate_publication
after insert or update or delete on public.benefit_unique_codes deferrable initially deferred
for each row execute function public.validate_benefit_child_trigger();

create function public.get_published_benefits(
  p_celebrity_slug text, p_locale public.content_locale, p_now timestamptz default now()
) returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', benefit.id, 'slug', benefit.slug,
    'title', localization.title, 'summary', localization.summary,
    'eligibilityLabel', localization.eligibility_label,
    'deliveryLabel', localization.delivery_label,
    'deliveryType', benefit.delivery_type,
    'claimOpensAt', benefit.claim_opens_at, 'claimClosesAt', benefit.claim_closes_at,
    'minimumScore', benefit.minimum_score, 'minimumLevel', benefit.minimum_level,
    'requiredStampType', benefit.required_stamp_type,
    'requiredActivityType', benefit.required_activity_type,
    'available', p_now >= benefit.claim_opens_at and p_now < benefit.claim_closes_at
      and (benefit.stock_limit is null or (
        select count(*) from public.benefit_claims claim where claim.benefit_id = benefit.id
      ) < benefit.stock_limit)
      and (benefit.delivery_type <> 'unique_code' or exists (
        select 1 from public.benefit_unique_codes code
        where code.benefit_id = benefit.id and code.claimed_by_claim_id is null
      ))
  )
  from public.benefits benefit
  join public.celebrities celebrity on celebrity.id = benefit.celebrity_id
  join public.benefit_localizations localization
    on localization.benefit_id = benefit.id and localization.locale = p_locale
  where celebrity.slug = p_celebrity_slug
    and celebrity.status = 'published'
    and benefit.publication_status = 'published'
  order by benefit.claim_opens_at, benefit.id;
$$;

create function public.claim_benefit(
  p_benefit_id uuid, p_app_user_id uuid, p_idempotency_key uuid,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_benefit public.benefits%rowtype;
  v_passport public.fan_passports%rowtype;
  v_existing public.benefit_claims%rowtype;
  v_claim_id uuid := extensions.gen_random_uuid();
  v_code public.benefit_unique_codes%rowtype;
  v_delivery_value text;
  v_score integer;
  v_level text;
  v_level_rank integer;
  v_required_rank integer;
  v_owner_count integer;
  v_total_count integer;
begin
  if p_benefit_id is null or p_app_user_id is null or p_idempotency_key is null then
    raise exception 'benefit, owner, and idempotency key are required';
  end if;

  select * into v_existing from public.benefit_claims
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.benefit_id <> p_benefit_id or v_existing.app_user_id <> p_app_user_id then
      raise exception 'idempotency key belongs to a different claim';
    end if;
    if v_existing.delivery_type = 'unique_code' then
      select code_value into v_delivery_value from public.benefit_unique_codes
      where id = v_existing.unique_code_id and claimed_by_claim_id = v_existing.id;
    else
      select secret_value into v_delivery_value from public.benefit_delivery_vault
      where benefit_id = v_existing.benefit_id and delivery_type = v_existing.delivery_type;
    end if;
    return jsonb_build_object('claimId', v_existing.id, 'benefitId', v_existing.benefit_id,
      'deliveryType', v_existing.delivery_type, 'deliveryValue', v_delivery_value,
      'claimedAt', v_existing.claimed_at, 'replayed', true);
  end if;

  select * into v_benefit from public.benefits where id = p_benefit_id for update;
  if not found or v_benefit.publication_status <> 'published' then
    raise exception 'benefit is not available';
  end if;
  if p_now < v_benefit.claim_opens_at or p_now >= v_benefit.claim_closes_at then
    raise exception 'benefit claim window is closed';
  end if;

  select * into v_passport from public.fan_passports
  where app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id;
  if not found then raise exception 'eligible fan passport is required'; end if;

  select coalesce(sum(points), 0)::integer into v_score from public.fan_score_ledger
  where app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id;
  v_level := case when v_score >= 35 then 'Diamond' when v_score >= 20 then 'Platinum'
    when v_score >= 10 then 'Gold' when v_score >= 5 then 'Silver' else 'Bronze' end;
  v_level_rank := case v_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 when 'Platinum' then 4 else 5 end;
  v_required_rank := case v_benefit.minimum_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 when 'Platinum' then 4 else 5 end;
  if v_score < v_benefit.minimum_score or v_level_rank < v_required_rank then
    raise exception 'benefit score or level requirement is not met';
  end if;
  if v_benefit.required_stamp_type is not null and not exists (
    select 1 from public.stamps where passport_id = v_passport.id
      and app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id
      and stamp_type = v_benefit.required_stamp_type
  ) then raise exception 'required stamp is missing'; end if;
  if v_benefit.required_activity_type is not null and not exists (
    select 1 from public.fan_activities where app_user_id = p_app_user_id
      and celebrity_id = v_benefit.celebrity_id
      and activity_type = v_benefit.required_activity_type
  ) then raise exception 'required activity is missing'; end if;

  select count(*)::integer into v_owner_count from public.benefit_claims
  where benefit_id = p_benefit_id and app_user_id = p_app_user_id;
  if v_owner_count >= v_benefit.per_user_limit then raise exception 'per-user claim limit reached'; end if;
  select count(*)::integer into v_total_count from public.benefit_claims where benefit_id = p_benefit_id;
  if v_benefit.stock_limit is not null and v_total_count >= v_benefit.stock_limit then
    raise exception 'benefit stock is exhausted';
  end if;

  if v_benefit.delivery_type = 'unique_code' then
    select * into v_code from public.benefit_unique_codes
    where benefit_id = p_benefit_id and claimed_by_claim_id is null
    order by created_at, id for update skip locked limit 1;
    if not found then raise exception 'benefit code inventory is exhausted'; end if;
    v_delivery_value := v_code.code_value;
  else
    select secret_value into v_delivery_value from public.benefit_delivery_vault
    where benefit_id = p_benefit_id and delivery_type = v_benefit.delivery_type;
    if not found then raise exception 'benefit delivery is not configured'; end if;
  end if;

  insert into public.benefit_claims (
    id, benefit_id, app_user_id, celebrity_id, passport_id,
    idempotency_key, delivery_type, unique_code_id, claimed_at
  ) values (
    v_claim_id, p_benefit_id, p_app_user_id, v_benefit.celebrity_id, v_passport.id,
    p_idempotency_key, v_benefit.delivery_type,
    case when v_benefit.delivery_type = 'unique_code' then v_code.id end, p_now
  );
  if v_benefit.delivery_type = 'unique_code' then
    update public.benefit_unique_codes set claimed_by_claim_id = v_claim_id
    where id = v_code.id and claimed_by_claim_id is null;
    if not found then raise exception 'unique code allocation conflict'; end if;
  end if;
  insert into public.benefit_claim_audits (
    benefit_claim_id, benefit_id, app_user_id, event_type, eligibility_snapshot
  ) values (v_claim_id, p_benefit_id, p_app_user_id, 'claimed', jsonb_build_object(
    'passportId', v_passport.id, 'score', v_score, 'level', v_level,
    'requiredStampType', v_benefit.required_stamp_type,
    'requiredActivityType', v_benefit.required_activity_type
  ));
  return jsonb_build_object('claimId', v_claim_id, 'benefitId', p_benefit_id,
    'deliveryType', v_benefit.delivery_type, 'deliveryValue', v_delivery_value,
    'claimedAt', p_now, 'replayed', false);
end;
$$;

create function public.get_owned_benefit_claims(
  p_app_user_id uuid, p_locale public.content_locale
) returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'claimId', claim.id, 'benefitId', benefit.id, 'benefitSlug', benefit.slug,
    'title', localization.title, 'deliveryType', claim.delivery_type,
    'deliveryValue', case when claim.delivery_type = 'unique_code' then code.code_value else vault.secret_value end,
    'claimedAt', claim.claimed_at
  )
  from public.benefit_claims claim
  join public.benefits benefit on benefit.id = claim.benefit_id
  join public.benefit_localizations localization
    on localization.benefit_id = benefit.id and localization.locale = p_locale
  left join public.benefit_unique_codes code
    on code.id = claim.unique_code_id and code.claimed_by_claim_id = claim.id
  left join public.benefit_delivery_vault vault
    on vault.benefit_id = benefit.id and vault.delivery_type = claim.delivery_type
  where claim.app_user_id = p_app_user_id
  order by claim.claimed_at desc, claim.id desc;
$$;

alter table public.benefits enable row level security;
alter table public.benefit_localizations enable row level security;
alter table public.benefit_delivery_vault enable row level security;
alter table public.benefit_unique_codes enable row level security;
alter table public.benefit_claims enable row level security;
alter table public.benefit_claim_audits enable row level security;

revoke all on public.benefits, public.benefit_localizations,
  public.benefit_delivery_vault, public.benefit_unique_codes,
  public.benefit_claims, public.benefit_claim_audits from public, anon, authenticated;
grant select, insert, update, delete on public.benefits, public.benefit_localizations to service_role;
grant select, insert, update, delete on public.benefit_delivery_vault to service_role;
grant select, insert on public.benefit_unique_codes to service_role;
grant select, insert on public.benefit_claims, public.benefit_claim_audits to service_role;
grant execute on function public.get_published_benefits(text, public.content_locale, timestamptz) to service_role;
grant execute on function public.claim_benefit(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.get_owned_benefit_claims(uuid, public.content_locale) to service_role;
grant execute on function public.assert_benefit_publishable(uuid) to service_role;

revoke all on function public.get_published_benefits(text, public.content_locale, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_benefit(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_owned_benefit_claims(uuid, public.content_locale) from public, anon, authenticated;
revoke all on function public.assert_benefit_publishable(uuid) from public, anon, authenticated;
revoke all on function public.reject_benefit_claim_audit_mutation() from public, anon, authenticated;
revoke all on function public.prepare_benefit_publication() from public, anon, authenticated;
revoke all on function public.validate_benefit_publication_trigger() from public, anon, authenticated;
revoke all on function public.validate_benefit_child_trigger() from public, anon, authenticated;

comment on table public.benefit_delivery_vault is 'Private shared delivery material; never included in public catalog projections.';
comment on table public.benefit_unique_codes is 'Private one-time code inventory allocated with row locks by claim_benefit.';
comment on table public.benefit_claim_audits is 'Append-only claim and eligibility evidence; no update or delete grant.';
