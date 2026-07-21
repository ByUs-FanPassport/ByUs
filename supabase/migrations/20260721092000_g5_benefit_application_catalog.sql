-- Expose allocation semantics in the public catalog without exposing application
-- owners, decisions, delivery material, or inventory values.
create or replace function public.get_published_benefits(
  p_celebrity_slug text, p_locale public.content_locale, p_now timestamptz default now()
) returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', benefit.id, 'slug', benefit.slug,
    'title', localization.title, 'summary', localization.summary,
    'eligibilityLabel', localization.eligibility_label,
    'deliveryLabel', localization.delivery_label,
    'deliveryType', benefit.delivery_type,
    'allocationMode', benefit.allocation_mode,
    'claimOpensAt', benefit.claim_opens_at, 'claimClosesAt', benefit.claim_closes_at,
    'minimumScore', benefit.minimum_score, 'minimumLevel', benefit.minimum_level,
    'requiredStampType', benefit.required_stamp_type,
    'requiredActivityType', benefit.required_activity_type,
    'available', p_now >= benefit.claim_opens_at and p_now < benefit.claim_closes_at
      and benefit.archived_at is null
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
    and celebrity.status = 'published' and celebrity.archived_at is null
    and benefit.publication_status = 'published' and benefit.archived_at is null
  order by benefit.claim_opens_at, benefit.id;
$$;

revoke all on function public.get_published_benefits(text, public.content_locale, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_published_benefits(text, public.content_locale, timestamptz)
  to service_role;

create function public.enforce_visible_benefit_application()
returns trigger language plpgsql set search_path='' as $$
declare v_benefit public.benefits%rowtype; v_celebrity public.celebrities%rowtype;
begin
  select * into v_benefit from public.benefits where id=new.benefit_id for key share;
  if not found or v_benefit.publication_status<>'published' or v_benefit.archived_at is not null
     or v_benefit.allocation_mode<>'application_selection' then
    raise exception 'application benefit unavailable';
  end if;
  select * into v_celebrity from public.celebrities where id=v_benefit.celebrity_id for key share;
  if not found or v_celebrity.status<>'published' or v_celebrity.archived_at is not null then
    raise exception 'application celebrity unavailable';
  end if;
  return new;
end $$;
create trigger benefit_applications_visible_parent
before insert on public.benefit_applications
for each row execute function public.enforce_visible_benefit_application();

create function public.get_owned_benefit_application(p_benefit_id uuid,p_app_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'applicationId',application.id,'benefitId',application.benefit_id,
    'status',application.status,'submittedAt',application.submitted_at,
    'claim',case when application.status='selected' then jsonb_build_object(
      'claimId',claim.id,'benefitId',claim.benefit_id,'deliveryType',claim.delivery_type,
      'deliveryValue',case when claim.delivery_type='unique_code' then code.code_value else vault.secret_value end,
      'claimedAt',claim.claimed_at
    ) else null end
  )
  from public.benefit_applications application
  left join public.benefit_claims claim
    on claim.id=application.selection_claim_id
   and claim.benefit_application_id=application.id
   and claim.benefit_id=application.benefit_id
   and claim.app_user_id=application.app_user_id
  left join public.benefit_unique_codes code
    on code.id=claim.unique_code_id and code.claimed_by_claim_id=claim.id
  left join public.benefit_delivery_vault vault
    on vault.benefit_id=claim.benefit_id and vault.delivery_type=claim.delivery_type
  where application.benefit_id=p_benefit_id and application.app_user_id=p_app_user_id
    and (application.status<>'selected' or claim.id is not null);
$$;
revoke all on function public.enforce_visible_benefit_application() from public,anon,authenticated,service_role;
revoke all on function public.get_owned_benefit_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_owned_benefit_application(uuid,uuid) to service_role;
