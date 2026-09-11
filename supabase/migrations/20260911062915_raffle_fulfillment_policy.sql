-- Per-item immutable raffle fulfillment policy, owner result projections, and
-- serialized recipient/claim operations. Existing policy-less rows remain legacy.

create table public.raffle_fulfillment_policies (
  campaign_id uuid not null,
  benefit_id uuid not null,
  version text not null check (length(btrim(version)) between 1 and 100),
  method public.benefit_fulfillment_method not null,
  shipping_country text,
  requires_shipping_acknowledgment boolean not null,
  recipient_window_days integer not null check (recipient_window_days=7),
  pickup_ends_on date,
  pickup_venue_ko text not null default '',
  pickup_venue_en text not null default '',
  pickup_instructions_ko text not null default '',
  pickup_instructions_en text not null default '',
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  primary key(campaign_id,benefit_id,version),
  foreign key(campaign_id,benefit_id)
    references public.live_benefit_campaign_items(campaign_id,benefit_id) on delete restrict,
  constraint raffle_fulfillment_policy_method_shape check (
    (method='physical_shipping' and shipping_country='KR'
      and requires_shipping_acknowledgment and pickup_ends_on is null)
    or (method='on_site_pickup' and shipping_country is null
      and not requires_shipping_acknowledgment)
    or (method='digital' and shipping_country is null
      and not requires_shipping_acknowledgment and pickup_ends_on is null)
  )
);

alter table public.raffle_fulfillment_policies enable row level security;
alter table public.raffle_fulfillment_policies force row level security;
revoke all on table public.raffle_fulfillment_policies from public,anon,authenticated,service_role;
create trigger raffle_fulfillment_policies_reject_update_delete
before update or delete on public.raffle_fulfillment_policies for each row
execute function public.reject_benefit_economy_history_mutation();
create trigger raffle_fulfillment_policies_reject_truncate
before truncate on public.raffle_fulfillment_policies for each statement
execute function public.reject_benefit_economy_history_truncate();

alter table public.live_benefit_campaign_items
  add column active_fulfillment_policy_version text,
  add constraint live_benefit_campaign_item_active_policy_fk
    foreign key(campaign_id,benefit_id,active_fulfillment_policy_version)
    references public.raffle_fulfillment_policies(campaign_id,benefit_id,version) on delete restrict;

alter table public.benefit_ticket_entries
  add column fulfillment_policy_version text,
  add column can_receive_in_korea boolean,
  add column policy_acknowledged_at timestamptz,
  add column policy_acknowledgment_source text not null default 'legacy'
    check (policy_acknowledgment_source in ('legacy','explicit')),
  add constraint benefit_ticket_entry_policy_ack_shape check (
    (policy_acknowledgment_source='legacy' and fulfillment_policy_version is null
      and can_receive_in_korea is null and policy_acknowledged_at is null)
    or (policy_acknowledgment_source='explicit' and fulfillment_policy_version is not null
      and can_receive_in_korea is not null and policy_acknowledged_at is not null)
  ),
  add constraint benefit_ticket_entry_policy_fk
    foreign key(campaign_id,benefit_id,fulfillment_policy_version)
    references public.raffle_fulfillment_policies(campaign_id,benefit_id,version) on delete restrict;

alter table public.benefit_recipient_private
  add column phone_country text,
  add column shipping_country text,
  add column phone_normalization_status text not null default 'legacy_review_required'
    check (phone_normalization_status in ('normalized','legacy_review_required'));

insert into public.benefit_recipient_consent_versions(version,active,effective_at)
values('2026-09-raffle-v2',true,pg_catalog.statement_timestamp());

alter table public.benefit_fulfillments
  add column fulfillment_policy_version text,
  add column recipient_deadline_at timestamptz,
  add column claim_disposition text not null default 'active'
    check (claim_disposition in ('active','unclaimed')),
  add column closed_at timestamptz,
  add column claim_closed_reason text,
  add column claim_closed_by_app_user_id uuid references public.app_users(id) on delete restrict,
  add column claim_closed_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  add constraint benefit_fulfillment_claim_shape check (
    (claim_disposition='active' and closed_at is null and claim_closed_reason is null
      and claim_closed_by_app_user_id is null and claim_closed_by_admin_allowlist_id is null)
    or (claim_disposition='unclaimed' and closed_at is not null
      and length(btrim(claim_closed_reason)) between 10 and 1000
      and claim_closed_by_app_user_id is not null
      and claim_closed_by_admin_allowlist_id is not null)
  );

create function public.raffle_fulfillment_policy_json(
  p_campaign_id uuid,p_benefit_id uuid,p_version text
) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'version',policy.version,'method',policy.method,
    'shippingCountry',policy.shipping_country,
    'requiresShippingAcknowledgment',policy.requires_shipping_acknowledgment,
    'recipientWindowDays',policy.recipient_window_days,
    'pickupEndsOn',policy.pickup_ends_on,
    'pickupVenue',jsonb_build_object('ko',policy.pickup_venue_ko,'en',policy.pickup_venue_en),
    'pickupInstructions',jsonb_build_object(
      'ko',policy.pickup_instructions_ko,'en',policy.pickup_instructions_en)
  )
  from public.raffle_fulfillment_policies policy
  where policy.campaign_id=p_campaign_id and policy.benefit_id=p_benefit_id
    and policy.version=p_version;
$$;

create function public.configure_admin_raffle_fulfillment_policy(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_benefit_id uuid,p_expected_campaign_revision integer,p_policy jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  campaign public.live_benefit_campaigns%rowtype;
  item public.live_benefit_campaign_items%rowtype;
  v_version text:=btrim(coalesce(p_policy->>'version',''));
  v_method public.benefit_fulfillment_method;
  v_shipping_country text:=nullif(btrim(coalesce(p_policy->>'shippingCountry','')),'');
  v_requires_ack boolean;
  v_window integer;
  v_pickup_ends_on date;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if jsonb_typeof(p_policy) is distinct from 'object' or length(v_version) not between 1 and 100
    or jsonb_typeof(p_policy->'requiresShippingAcknowledgment') is distinct from 'boolean'
    or jsonb_typeof(p_policy->'recipientWindowDays') is distinct from 'number'
    or jsonb_typeof(p_policy->'pickupVenue') is distinct from 'object'
    or jsonb_typeof(p_policy->'pickupInstructions') is distinct from 'object'
    or not (p_policy->'pickupVenue' ?& array['ko','en'])
    or not (p_policy->'pickupInstructions' ?& array['ko','en'])
    or jsonb_typeof(p_policy->'pickupVenue'->'ko') is distinct from 'string'
    or jsonb_typeof(p_policy->'pickupVenue'->'en') is distinct from 'string'
    or jsonb_typeof(p_policy->'pickupInstructions'->'ko') is distinct from 'string'
    or jsonb_typeof(p_policy->'pickupInstructions'->'en') is distinct from 'string' then
    raise exception 'RAFFLE_FULFILLMENT_POLICY_INVALID';
  end if;
  begin
    v_method:=(p_policy->>'method')::public.benefit_fulfillment_method;
    v_requires_ack:=(p_policy->>'requiresShippingAcknowledgment')::boolean;
    v_window:=(p_policy->>'recipientWindowDays')::integer;
    v_pickup_ends_on:=nullif(p_policy->>'pickupEndsOn','')::date;
  exception when others then
    raise exception 'RAFFLE_FULFILLMENT_POLICY_INVALID';
  end;
  select * into campaign from public.live_benefit_campaigns
    where id=p_campaign_id for update;
  if not found then raise exception 'PHASE4_BENEFIT_CAMPAIGN_NOT_FOUND'; end if;
  if p_expected_campaign_revision is null
    or campaign.revision<>p_expected_campaign_revision then
    raise exception 'PHASE4_BENEFIT_CAMPAIGN_REVISION_CONFLICT';
  end if;
  select * into item from public.live_benefit_campaign_items
    where campaign_id=p_campaign_id and benefit_id=p_benefit_id for update;
  if not found then raise exception 'RAFFLE_FULFILLMENT_ITEM_NOT_FOUND'; end if;
  if exists(select 1 from public.benefit_draw_publications publication
    where publication.campaign_id=p_campaign_id) then
    raise exception 'RAFFLE_POLICY_ACTIVATION_AFTER_RESULT_PUBLICATION';
  end if;
  if item.fulfillment_method<>v_method or v_window<>7
    or (v_method='physical_shipping' and (v_shipping_country is distinct from 'KR' or not v_requires_ack or v_pickup_ends_on is not null))
    or (v_method<>'physical_shipping' and (v_shipping_country is not null or v_requires_ack))
    or (v_method='digital' and v_pickup_ends_on is not null) then
    raise exception 'RAFFLE_FULFILLMENT_POLICY_INVALID';
  end if;
  insert into public.raffle_fulfillment_policies(
    campaign_id,benefit_id,version,method,shipping_country,
    requires_shipping_acknowledgment,recipient_window_days,pickup_ends_on,
    pickup_venue_ko,pickup_venue_en,pickup_instructions_ko,pickup_instructions_en,
    actor_app_user_id,actor_admin_allowlist_id,correlation_id
  ) values(
    p_campaign_id,p_benefit_id,v_version,v_method,v_shipping_country,
    v_requires_ack,v_window,v_pickup_ends_on,
    coalesce(p_policy->'pickupVenue'->>'ko',''),coalesce(p_policy->'pickupVenue'->>'en',''),
    coalesce(p_policy->'pickupInstructions'->>'ko',''),coalesce(p_policy->'pickupInstructions'->>'en',''),
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id
  );
  update public.live_benefit_campaign_items
    set active_fulfillment_policy_version=v_version
    where campaign_id=p_campaign_id and benefit_id=p_benefit_id;
  update public.live_benefit_campaigns set revision=revision+1 where id=p_campaign_id;
  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'raffle_fulfillment_policy.activated',
    'live_benefit_campaign_item',item.id::text,p_correlation_id,
    jsonb_build_object('campaignId',p_campaign_id,'benefitId',p_benefit_id,
      'previousVersion',item.active_fulfillment_policy_version,'version',v_version)
  );
  return public.raffle_fulfillment_policy_json(p_campaign_id,p_benefit_id,v_version);
exception when unique_violation then
  raise exception 'RAFFLE_FULFILLMENT_POLICY_VERSION_EXISTS' using errcode='23505';
end;
$$;

create function public.get_admin_raffle_fulfillment_policy(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,
  p_campaign_id uuid,p_benefit_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_version text;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select active_fulfillment_policy_version into v_version
  from public.live_benefit_campaign_items
  where campaign_id=p_campaign_id and benefit_id=p_benefit_id;
  if not found then raise exception 'RAFFLE_FULFILLMENT_ITEM_NOT_FOUND'; end if;
  return public.raffle_fulfillment_policy_json(p_campaign_id,p_benefit_id,v_version);
end;
$$;

-- Policy-aware entry is replay-safe. A prior successful key is returned before
-- validating the currently active policy, while a changed replay payload conflicts.
create function public.enter_owned_benefit_v2(
  p_app_user_id uuid,p_benefit_id uuid,p_idempotency_key uuid,p_ticket_amount integer,
  p_policy_version text,p_can_receive_in_korea boolean,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  existing public.benefit_ticket_entries%rowtype;
  campaign public.live_benefit_campaigns%rowtype;
  item public.live_benefit_campaign_items%rowtype;
  policy public.raffle_fulfillment_policies%rowtype;
  v_celebrity uuid; v_benefit_status public.content_status;
  v_total bigint; v_next bigint; v_reward_policy integer;
  v_entry_id uuid:=extensions.gen_random_uuid(); ledger jsonb;
begin
  if p_app_user_id is null or p_benefit_id is null or p_idempotency_key is null
    or p_ticket_amount is null or p_ticket_amount<=0 then
    raise exception 'PHASE4_BENEFIT_ENTRY_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0));
  select * into existing from public.benefit_ticket_entries where idempotency_key=p_idempotency_key;
  if found then
    if existing.app_user_id<>p_app_user_id or existing.benefit_id<>p_benefit_id
      or existing.ticket_amount<>p_ticket_amount
      or existing.policy_acknowledgment_source<>'explicit'
      or existing.fulfillment_policy_version is distinct from p_policy_version
      or existing.can_receive_in_korea is distinct from p_can_receive_in_korea then
      raise exception 'PHASE4_BENEFIT_ENTRY_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    select jsonb_build_object(
      'entryId',existing.id,'benefitId',existing.benefit_id,'campaignId',existing.campaign_id,
      'ticketAmount',existing.ticket_amount,'benefitTicketTotal',existing.benefit_ticket_total,
      'perFanTicketLimit',existing.per_fan_ticket_limit,
      'remainingBenefitTickets',case when existing.per_fan_ticket_limit is null then null
        else existing.per_fan_ticket_limit-existing.benefit_ticket_total end,
      'ticketLedgerId',existing.ticket_ledger_id,'resultingBalance',l.resulting_balance,'replayed',true
    ) into ledger from public.fan_ticket_ledger l where l.id=existing.ticket_ledger_id;
    return ledger;
  end if;
  select c.* into campaign from public.live_benefit_campaigns c
    join public.live_benefit_campaign_items i on i.campaign_id=c.id
    where i.benefit_id=p_benefit_id and c.status='published'
    order by c.entry_closes_at desc,c.id desc limit 1 for update of c;
  if not found then raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE'; end if;
  select * into item from public.live_benefit_campaign_items
    where campaign_id=campaign.id and benefit_id=p_benefit_id for update;
  if item.active_fulfillment_policy_version is null then
    raise exception 'RAFFLE_POLICY_NOT_ACTIVE';
  end if;
  select * into strict policy from public.raffle_fulfillment_policies
    where campaign_id=campaign.id and benefit_id=p_benefit_id
      and version=item.active_fulfillment_policy_version;
  if p_policy_version is distinct from policy.version
    or (policy.requires_shipping_acknowledgment and p_can_receive_in_korea is distinct from true) then
    raise exception 'RAFFLE_POLICY_ACK_REQUIRED';
  end if;
  select b.celebrity_id,b.publication_status into v_celebrity,v_benefit_status
    from public.benefits b where b.id=p_benefit_id;
  if campaign.cancelled_at is not null or v_benefit_status<>'published' then
    raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE';
  end if;
  if campaign.entry_opens_at is null or campaign.entry_closes_at is null
    or p_now<campaign.entry_opens_at or p_now>=campaign.entry_closes_at then
    raise exception 'PHASE4_BENEFIT_ENTRY_WINDOW_CLOSED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'phase4:benefit-entry:aggregate:'||p_app_user_id::text||':'||p_benefit_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'phase1:ticket:balance:'||p_app_user_id::text||':'||v_celebrity::text,0));
  select coalesce(sum(ticket_amount),0) into v_total from public.benefit_ticket_entries
    where app_user_id=p_app_user_id and campaign_id=campaign.id and benefit_id=p_benefit_id;
  v_next:=v_total+p_ticket_amount;
  if item.per_fan_ticket_limit is not null and v_next>item.per_fan_ticket_limit then
    raise exception 'PHASE4_BENEFIT_ENTRY_LIMIT_REACHED' using errcode='23514';
  end if;
  select policy_version into v_reward_policy from public.reward_policy_activation where singleton;
  if v_reward_policy is null then raise exception 'PHASE4_BENEFIT_ENTRY_POLICY_UNAVAILABLE'; end if;
  ledger:=public.post_fan_ticket_entry(
    p_app_user_id,v_celebrity,'debit',-p_ticket_amount::bigint,'benefit_entry',v_entry_id,
    p_idempotency_key,v_reward_policy,null,null);
  insert into public.benefit_ticket_entries(
    id,idempotency_key,campaign_id,benefit_id,app_user_id,ticket_amount,ticket_ledger_id,
    benefit_ticket_total,per_fan_ticket_limit,fulfillment_policy_version,
    can_receive_in_korea,policy_acknowledged_at,policy_acknowledgment_source
  ) values(
    v_entry_id,p_idempotency_key,campaign.id,p_benefit_id,p_app_user_id,p_ticket_amount,
    (ledger->>'entryId')::uuid,v_next::integer,item.per_fan_ticket_limit,policy.version,
    p_can_receive_in_korea,pg_catalog.statement_timestamp(),'explicit'
  ) returning * into existing;
  return jsonb_build_object(
    'entryId',existing.id,'benefitId',existing.benefit_id,'campaignId',existing.campaign_id,
    'ticketAmount',existing.ticket_amount,'benefitTicketTotal',existing.benefit_ticket_total,
    'perFanTicketLimit',existing.per_fan_ticket_limit,
    'remainingBenefitTickets',case when existing.per_fan_ticket_limit is null then null
      else existing.per_fan_ticket_limit-existing.benefit_ticket_total end,
    'ticketLedgerId',existing.ticket_ledger_id,'resultingBalance',(ledger->>'balance')::bigint,
    'replayed',false);
end;
$$;

alter function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz)
  rename to enter_owned_benefit_without_fulfillment_policy;
create function public.enter_owned_benefit(
  p_app_user_id uuid,p_benefit_id uuid,p_idempotency_key uuid,p_ticket_amount integer,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  existing public.benefit_ticket_entries%rowtype;
  campaign public.live_benefit_campaigns%rowtype;
  item public.live_benefit_campaign_items%rowtype;
  result jsonb;
begin
  if p_app_user_id is null or p_benefit_id is null or p_idempotency_key is null
    or p_ticket_amount is null or p_ticket_amount<=0 then
    raise exception 'PHASE4_BENEFIT_ENTRY_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0));
  select * into existing from public.benefit_ticket_entries where idempotency_key=p_idempotency_key;
  if found then
    if existing.app_user_id<>p_app_user_id or existing.benefit_id<>p_benefit_id
      or existing.ticket_amount<>p_ticket_amount then
      raise exception 'PHASE4_BENEFIT_ENTRY_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    select jsonb_build_object(
      'entryId',existing.id,'benefitId',existing.benefit_id,'campaignId',existing.campaign_id,
      'ticketAmount',existing.ticket_amount,'benefitTicketTotal',existing.benefit_ticket_total,
      'perFanTicketLimit',existing.per_fan_ticket_limit,
      'remainingBenefitTickets',case when existing.per_fan_ticket_limit is null then null
        else existing.per_fan_ticket_limit-existing.benefit_ticket_total end,
      'ticketLedgerId',existing.ticket_ledger_id,'resultingBalance',ledger.resulting_balance,
      'replayed',true
    ) into result from public.fan_ticket_ledger ledger where ledger.id=existing.ticket_ledger_id;
    return result;
  end if;
  select c.* into campaign from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1 for update of c;
  if found then
    select * into item from public.live_benefit_campaign_items
    where campaign_id=campaign.id and benefit_id=p_benefit_id for update;
    if campaign.cancelled_at is null
      and item.active_fulfillment_policy_version is not null then
      raise exception 'RAFFLE_POLICY_ACK_REQUIRED';
    end if;
  end if;
  return public.enter_owned_benefit_without_fulfillment_policy(
    p_app_user_id,p_benefit_id,p_idempotency_key,p_ticket_amount,p_now);
end;
$$;

-- Draw publication captures the exact per-winner policy and 168-hour deadline.
alter function public.publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz)
  rename to publish_admin_benefit_draw_without_recipient_deadlines;
create function public.publish_admin_benefit_draw(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_draw_id uuid,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_published_at timestamptz;
begin
  result:=public.publish_admin_benefit_draw_without_recipient_deadlines(
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_campaign_id,p_draw_id,p_now);
  select published_at into strict v_published_at from public.benefit_draw_publications
    where draw_id=p_draw_id and campaign_id=p_campaign_id;
  update public.benefit_fulfillments fulfillment set
    fulfillment_policy_version=item.active_fulfillment_policy_version,
    recipient_deadline_at=case when item.active_fulfillment_policy_version is null then null
      else v_published_at+interval '168 hours' end
  from public.benefit_draw_winners winner
  join public.live_benefit_campaign_items item
    on item.campaign_id=winner.campaign_id and item.benefit_id=winner.benefit_id
  where fulfillment.winner_id=winner.id and winner.draw_id=p_draw_id
    and fulfillment.fulfillment_policy_version is null;
  return result;
end;
$$;

-- Add the active public policy to both guest and owner entry reads.
alter function public.get_owned_benefit_entry_state(uuid,uuid)
  rename to get_owned_benefit_entry_state_without_fulfillment_policy;
create function public.get_owned_benefit_entry_state(p_app_user_id uuid,p_benefit_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; v_campaign uuid; v_version text;
begin
  result:=public.get_owned_benefit_entry_state_without_fulfillment_policy(p_app_user_id,p_benefit_id);
  if result is null then return null; end if;
  v_campaign:=(result->>'campaignId')::uuid;
  select active_fulfillment_policy_version into v_version
  from public.live_benefit_campaign_items
  where campaign_id=v_campaign and benefit_id=p_benefit_id;
  return result||jsonb_build_object('fulfillmentPolicy',
    public.raffle_fulfillment_policy_json(v_campaign,p_benefit_id,v_version));
end;
$$;

create or replace function public.get_public_raffles(
  p_celebrity_slug text,p_locale public.content_locale,p_now timestamptz default pg_catalog.now()
) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('raffles',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'benefitId',i.benefit_id,'title',coalesce(l.title,b.slug),
    'summary',coalesce(l.summary,b.slug),'imageUrl',i.teaser_image_url,
    'winnerQuantity',i.winner_quantity,
    'status',case when c.cancelled_at is not null then 'cancelled'
      when c.status='draft' then 'preparing' when p_now<c.entry_opens_at then 'preparing'
      when p_now<c.entry_closes_at then 'open' else 'closed' end,
    'entryOpensAt',c.entry_opens_at,'entryClosesAt',c.entry_closes_at,
    'fulfillmentMethod',i.fulfillment_method,'perFanTicketLimit',i.per_fan_ticket_limit,
    'fulfillmentPolicy',public.raffle_fulfillment_policy_json(
      c.id,i.benefit_id,i.active_fulfillment_policy_version)
  ) order by c.entry_opens_at nulls last,i.priority,c.id),'[]'::jsonb))
  from public.live_benefit_campaigns c
  join public.live_events e on e.id=c.live_event_id
  join public.celebrities celebrity on celebrity.id=e.celebrity_id and celebrity.slug=p_celebrity_slug
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  join public.benefits b on b.id=i.benefit_id
  left join public.benefit_localizations l on l.benefit_id=b.id and l.locale=p_locale
  where celebrity.status='published' and celebrity.archived_at is null
    and e.publication_status='published' and e.archived_at is null and b.archived_at is null
    and ((c.status='published' and b.publication_status='published')
      or (c.status='draft' and c.public_teaser and b.publication_status='draft'));
$$;

create function public.get_owned_benefit_recipient(
  p_app_user_id uuid,p_winner_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'winnerId',winner.id,'revision',fulfillment.revision,
    'editable',fulfillment.claim_disposition='active'
      and (fulfillment.recipient_deadline_at is null
        or pg_catalog.statement_timestamp()<fulfillment.recipient_deadline_at)
      and fulfillment.status in ('information_required','ready'),
    'deadlineAt',fulfillment.recipient_deadline_at,
    'claimDisposition',fulfillment.claim_disposition,
    'policy',public.raffle_fulfillment_policy_json(
      winner.campaign_id,winner.benefit_id,fulfillment.fulfillment_policy_version),
    'recipient',case when recipient.winner_id is null then null else jsonb_build_object(
      'name',recipient.name,'phone',recipient.phone,'phoneCountry',recipient.phone_country,
      'postalCode',recipient.postal_code,'address1',recipient.address1,
      'address2',recipient.address2,'shippingCountry',recipient.shipping_country) end
  ) into result
  from public.benefit_draw_winners winner
  join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
  join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
  left join public.benefit_recipient_private recipient on recipient.winner_id=winner.id
  where winner.id=p_winner_id and winner.app_user_id=p_app_user_id;
  if result is null then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  return result;
end;
$$;

create function public.save_owned_benefit_recipient_v2(
  p_app_user_id uuid,p_winner_id uuid,p_correlation_id uuid,
  p_consent_version text,p_consented boolean,p_name text,p_phone text,
  p_phone_country text,p_shipping_country text,p_postal_code text,
  p_address1 text,p_address2 text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  fulfillment public.benefit_fulfillments%rowtype;
  v_now timestamptz:=pg_catalog.statement_timestamp();
  v_from_status public.benefit_fulfillment_status;
begin
  select f.* into fulfillment
  from public.benefit_fulfillments f
  join public.benefit_draw_winners w on w.id=f.winner_id
  join public.benefit_draw_publications publication on publication.draw_id=w.draw_id
  where f.winner_id=p_winner_id and w.app_user_id=p_app_user_id for update of f;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if fulfillment.fulfillment_policy_version is null then
    raise exception 'RAFFLE_RECIPIENT_POLICY_REQUIRED';
  end if;
  if fulfillment.claim_disposition<>'active' then raise exception 'RAFFLE_CLAIM_CLOSED'; end if;
  if p_expected_revision is null or fulfillment.revision<>p_expected_revision then
    raise exception 'PHASE4_FULFILLMENT_REVISION_CONFLICT';
  end if;
  if fulfillment.method='digital' then raise exception 'PHASE4_RECIPIENT_NOT_REQUIRED'; end if;
  if fulfillment.status not in ('information_required','ready') then
    raise exception 'PHASE4_RECIPIENT_STATE_CONFLICT';
  end if;
  if fulfillment.recipient_deadline_at is null or v_now>=fulfillment.recipient_deadline_at then
    raise exception 'RAFFLE_RECIPIENT_DEADLINE_PASSED';
  end if;
  if p_consent_version is distinct from '2026-09-raffle-v2'
    or p_consented is distinct from true or not exists(
    select 1 from public.benefit_recipient_consent_versions consent
    where consent.version=p_consent_version and consent.active and consent.effective_at<=v_now
  ) then raise exception 'PHASE4_RECIPIENT_CONSENT_INVALID'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 120
    or btrim(coalesce(p_phone,''))!~ '^\+[1-9][0-9]{6,14}$'
    or btrim(coalesce(p_phone_country,''))!~ '^[A-Z]{2}$' then
    raise exception 'PHASE4_RECIPIENT_INVALID';
  end if;
  if fulfillment.method='physical_shipping' and (
    p_shipping_country is distinct from 'KR'
    or length(btrim(coalesce(p_postal_code,''))) not between 1 and 20
    or length(btrim(coalesce(p_address1,''))) not between 1 and 300
    or length(btrim(coalesce(p_address2,'')))>300
  ) then raise exception 'RAFFLE_KR_SHIPPING_ADDRESS_REQUIRED'; end if;
  if fulfillment.method='on_site_pickup' and (
    nullif(btrim(coalesce(p_shipping_country,'')),'') is not null
    or nullif(btrim(coalesce(p_postal_code,'')),'') is not null
    or nullif(btrim(coalesce(p_address1,'')),'') is not null
    or nullif(btrim(coalesce(p_address2,'')),'') is not null
  ) then raise exception 'RAFFLE_PICKUP_ADDRESS_FORBIDDEN'; end if;
  v_from_status:=fulfillment.status;
  insert into public.benefit_recipient_private(
    winner_id,consent_version,consented_at,name,phone,phone_country,shipping_country,
    postal_code,address1,address2,phone_normalization_status
  ) values(
    p_winner_id,p_consent_version,v_now,btrim(p_name),btrim(p_phone),btrim(p_phone_country),
    case when fulfillment.method='physical_shipping' then 'KR' else null end,
    case when fulfillment.method='physical_shipping' then btrim(p_postal_code) else null end,
    case when fulfillment.method='physical_shipping' then btrim(p_address1) else null end,
    case when fulfillment.method='physical_shipping' then nullif(btrim(coalesce(p_address2,'')),'') else null end,
    'normalized'
  ) on conflict(winner_id) do update set
    consent_version=excluded.consent_version,consented_at=excluded.consented_at,
    name=excluded.name,phone=excluded.phone,phone_country=excluded.phone_country,
    shipping_country=excluded.shipping_country,postal_code=excluded.postal_code,
    address1=excluded.address1,address2=excluded.address2,
    phone_normalization_status='normalized';
  update public.benefit_fulfillments set status='ready',revision=revision+1
    where id=fulfillment.id;
  insert into public.benefit_fulfillment_events(
    fulfillment_id,from_status,to_status,actor_app_user_id,correlation_id
  ) values(fulfillment.id,v_from_status,'ready',p_app_user_id,p_correlation_id);
  return jsonb_build_object(
    'winnerId',p_winner_id,'method',fulfillment.method,'status','ready',
    'revision',fulfillment.revision+1);
end;
$$;

alter function public.save_owned_benefit_recipient(
  uuid,uuid,uuid,text,boolean,text,text,text,text,text
) rename to save_owned_benefit_recipient_without_fulfillment_policy;
create function public.save_owned_benefit_recipient(
  p_app_user_id uuid,p_winner_id uuid,p_correlation_id uuid,
  p_consent_version text,p_consented boolean,p_name text,p_phone text,
  p_postal_code text default null,p_address1 text default null,p_address2 text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare fulfillment public.benefit_fulfillments%rowtype;
begin
  select f.* into fulfillment from public.benefit_fulfillments f
  join public.benefit_draw_winners winner on winner.id=f.winner_id
  where f.winner_id=p_winner_id and winner.app_user_id=p_app_user_id for update of f;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if fulfillment.claim_disposition<>'active' then raise exception 'RAFFLE_CLAIM_CLOSED'; end if;
  if fulfillment.fulfillment_policy_version is not null or exists(
    select 1 from public.benefit_draw_winners winner
    join public.live_benefit_campaign_items item
      on item.campaign_id=winner.campaign_id and item.benefit_id=winner.benefit_id
    where winner.id=p_winner_id and item.active_fulfillment_policy_version is not null
  ) then
    raise exception 'RAFFLE_RECIPIENT_V2_REQUIRED';
  end if;
  return public.save_owned_benefit_recipient_without_fulfillment_policy(
    p_app_user_id,p_winner_id,p_correlation_id,p_consent_version,p_consented,p_name,p_phone,
    p_postal_code,p_address1,p_address2);
end;
$$;

create function public.build_owned_raffle_result(
  p_app_user_id uuid,p_campaign_id uuid,p_benefit_id uuid,p_locale public.content_locale
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb; v_title text; v_method public.benefit_fulfillment_method;
  v_entry_closes_at timestamptz; v_cancelled boolean; v_entered integer;
  v_publication timestamptz; v_winner uuid; v_fulfillment public.benefit_fulfillments%rowtype;
  v_state text; v_policy_version text; v_recipient_submitted boolean:=false;
  v_carrier text; v_tracking_number text;
begin
  select case when p_locale='ko' then coalesce(ko.title,en.title,b.slug)
      else coalesce(en.title,ko.title,b.slug) end,
    item.fulfillment_method,c.entry_closes_at,c.cancelled_at is not null,
    item.active_fulfillment_policy_version
  into v_title,v_method,v_entry_closes_at,v_cancelled,v_policy_version
  from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items item on item.campaign_id=c.id
  join public.benefits b on b.id=item.benefit_id
  left join public.benefit_localizations ko on ko.benefit_id=b.id and ko.locale='ko'
  left join public.benefit_localizations en on en.benefit_id=b.id and en.locale='en'
  where c.id=p_campaign_id and item.benefit_id=p_benefit_id;
  if not found then return null; end if;
  select coalesce(sum(entry.ticket_amount),0)::integer into v_entered
  from public.benefit_ticket_entries entry
  where entry.app_user_id=p_app_user_id and entry.campaign_id=p_campaign_id
    and entry.benefit_id=p_benefit_id;
  select publication.published_at into v_publication
  from public.benefit_draws draw
  join public.benefit_draw_publications publication on publication.draw_id=draw.id
  where draw.campaign_id=p_campaign_id;
  if v_publication is not null then
    select winner.id into v_winner from public.benefit_draw_winners winner
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.app_user_id=p_app_user_id and winner.campaign_id=p_campaign_id
      and winner.benefit_id=p_benefit_id;
  end if;
  if v_winner is not null then
    select * into strict v_fulfillment from public.benefit_fulfillments
      where winner_id=v_winner;
    v_policy_version:=v_fulfillment.fulfillment_policy_version;
    select exists(select 1 from public.benefit_recipient_private where winner_id=v_winner)
      into v_recipient_submitted;
    if v_fulfillment.method='physical_shipping'
      and v_fulfillment.status in ('shipping_in_transit','shipping_completed') then
      select event.carrier,event.tracking_number into v_carrier,v_tracking_number
      from public.benefit_fulfillment_events event
      where event.fulfillment_id=v_fulfillment.id
        and event.to_status='shipping_in_transit'
      order by event.created_at desc,event.id desc limit 1;
    end if;
  end if;
  v_state:=case when v_cancelled then 'cancelled' when v_entered=0 then 'not_entered'
    when v_publication is null then 'pending' when v_winner is not null then 'won'
    else 'not_won' end;
  return jsonb_build_object(
    'benefitId',p_benefit_id,'campaignId',p_campaign_id,'title',v_title,
    'benefitHref','/benefits/'||p_benefit_id::text,'state',v_state,
    'enteredTickets',v_entered,'entryClosesAt',v_entry_closes_at,
    'publishedAt',case when v_state in ('won','not_won') then v_publication else null end,
    'winnerId',case when v_state='won' then v_winner else null end,'method',v_method,
    'fulfillmentStatus',case when v_state='won' then v_fulfillment.status else null end,
    'claimDisposition',case when v_state='won' then v_fulfillment.claim_disposition else 'active' end,
    'recipientDeadlineAt',case when v_state='won' then v_fulfillment.recipient_deadline_at else null end,
    'recipientSubmitted',case when v_state='won' then v_recipient_submitted else false end,
    'carrier',case when v_state='won' then v_carrier else null end,
    'trackingNumber',case when v_state='won' then v_tracking_number else null end,
    'recipientEditable',case when v_state='won' then
      v_fulfillment.claim_disposition='active'
      and v_fulfillment.status in ('information_required','ready')
      and (v_fulfillment.recipient_deadline_at is null
        or pg_catalog.statement_timestamp()<v_fulfillment.recipient_deadline_at)
      else false end,
    'policy',public.raffle_fulfillment_policy_json(
      p_campaign_id,p_benefit_id,v_policy_version));
end;
$$;

create function public.get_owned_raffle_result(
  p_app_user_id uuid,p_benefit_id uuid,p_locale public.content_locale
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_campaign uuid;
begin
  select c.id into v_campaign from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items item on item.campaign_id=c.id
  where item.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc nulls last,c.id desc limit 1;
  if not found then return null; end if;
  return public.build_owned_raffle_result(p_app_user_id,v_campaign,p_benefit_id,p_locale);
end;
$$;

create function public.get_owned_raffles(
  p_app_user_id uuid,p_locale public.content_locale,p_cursor text default null,p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_cursor_parts text[]; v_cursor_owner uuid; v_cursor_epoch numeric; v_cursor_id uuid;
  v_items jsonb; v_next text; v_count integer;
begin
  if p_app_user_id is null or p_limit not between 1 and 50 then
    raise exception 'RAFFLE_LIST_ARGUMENT_INVALID';
  end if;
  if p_cursor is not null then
    begin
      v_cursor_parts:=string_to_array(convert_from(decode(p_cursor,'hex'),'UTF8'),'|');
      if cardinality(v_cursor_parts)<>3 then raise exception 'invalid'; end if;
      v_cursor_owner:=v_cursor_parts[1]::uuid;
      v_cursor_epoch:=v_cursor_parts[2]::numeric;
      v_cursor_id:=v_cursor_parts[3]::uuid;
    exception when others then raise exception 'RAFFLE_LIST_CURSOR_INVALID'; end;
    if v_cursor_owner<>p_app_user_id then raise exception 'RAFFLE_LIST_CURSOR_OWNER_MISMATCH'; end if;
  end if;
  with owned as (
    select entry.campaign_id,entry.benefit_id,max(entry.entered_at) entered_at,
      item.id item_id
    from public.benefit_ticket_entries entry
    join public.live_benefit_campaign_items item
      on item.campaign_id=entry.campaign_id and item.benefit_id=entry.benefit_id
    where entry.app_user_id=p_app_user_id
    group by entry.campaign_id,entry.benefit_id,item.id
  ), page as (
    select owned.*,row_number() over(order by entered_at desc,item_id desc) rn
    from owned where p_cursor is null
      or (extract(epoch from entered_at),item_id)<(v_cursor_epoch,v_cursor_id)
    order by entered_at desc,item_id desc limit p_limit+1
  )
  select coalesce(jsonb_agg(public.build_owned_raffle_result(
      p_app_user_id,campaign_id,benefit_id,p_locale) order by entered_at desc,item_id desc)
      filter(where rn<=p_limit),'[]'::jsonb),
    count(*)::integer,
    max(case when rn=p_limit then encode(convert_to(
      p_app_user_id::text||'|'||extract(epoch from entered_at)::text||'|'||item_id::text,
      'UTF8'),'hex') end)
  into v_items,v_count,v_next from page;
  if v_count<=p_limit then v_next:=null; end if;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end;
$$;

alter table public.benefit_fulfillment_events
  add column verification_method text,
  add column verification_outcome text,
  add constraint benefit_fulfillment_event_verification_shape check (
    (verification_method is null and verification_outcome is null)
    or (verification_method='name_phone_last4'
      and verification_outcome in ('matched','manual_review'))
  );

alter function public.transition_admin_benefit_fulfillment(
  uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text
) rename to transition_admin_benefit_fulfillment_without_claim_guard;
create function public.transition_admin_benefit_fulfillment(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_expected_revision integer,p_to_status public.benefit_fulfillment_status,
  p_carrier text default null,p_tracking_number text default null,p_operator_memo text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare fulfillment public.benefit_fulfillments%rowtype;
begin
  select * into fulfillment from public.benefit_fulfillments
    where winner_id=p_winner_id for update;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if fulfillment.claim_disposition<>'active' then raise exception 'RAFFLE_CLAIM_CLOSED'; end if;
  if (fulfillment.fulfillment_policy_version is not null or exists(
      select 1 from public.benefit_draw_winners winner
      join public.live_benefit_campaign_items item
        on item.campaign_id=winner.campaign_id and item.benefit_id=winner.benefit_id
      where winner.id=p_winner_id and item.active_fulfillment_policy_version is not null
    ))
    and fulfillment.method='on_site_pickup' and p_to_status='pickup_completed' then
    raise exception 'RAFFLE_PICKUP_VERIFICATION_REQUIRED';
  end if;
  return public.transition_admin_benefit_fulfillment_without_claim_guard(
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_winner_id,
    p_expected_revision,p_to_status,p_carrier,p_tracking_number,p_operator_memo);
end;
$$;

create function public.transition_admin_benefit_fulfillment_v2(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_expected_revision integer,p_to_status public.benefit_fulfillment_status,
  p_carrier text,p_tracking_number text,p_operator_memo text,
  p_verification_method text,p_verification_outcome text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare fulfillment public.benefit_fulfillments%rowtype; v_allowed boolean:=false;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into fulfillment from public.benefit_fulfillments
    where winner_id=p_winner_id for update;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if not exists(select 1 from public.benefit_draw_winners winner
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.id=p_winner_id) then raise exception 'PHASE4_REWARD_NOT_PUBLISHED'; end if;
  if fulfillment.claim_disposition<>'active' then raise exception 'RAFFLE_CLAIM_CLOSED'; end if;
  if p_expected_revision is null or fulfillment.revision<>p_expected_revision then
    raise exception 'PHASE4_FULFILLMENT_REVISION_CONFLICT';
  end if;
  v_allowed:=case fulfillment.method
    when 'digital' then fulfillment.status='ready' and p_to_status='digital_delivered'
    when 'physical_shipping' then (fulfillment.status,p_to_status) in (
      ('ready','shipping_preparing'),('shipping_preparing','shipping_in_transit'),
      ('shipping_in_transit','shipping_completed'))
    when 'on_site_pickup' then (fulfillment.status,p_to_status) in (
      ('ready','pickup_available'),('pickup_available','pickup_completed'))
    else false end;
  if not v_allowed then raise exception 'PHASE4_FULFILLMENT_TRANSITION_INVALID'; end if;
  if p_to_status='shipping_in_transit' and (
    length(btrim(coalesce(p_carrier,'')))<1
    or length(btrim(coalesce(p_tracking_number,'')))<1
  ) then raise exception 'PHASE4_SHIPPING_TRACKING_REQUIRED'; end if;
  if length(btrim(coalesce(p_operator_memo,''))) not between 10 and 1000 then
    raise exception 'PHASE4_FULFILLMENT_OPERATOR_MEMO_REQUIRED';
  end if;
  if p_to_status='pickup_completed' and (
    p_verification_method is distinct from 'name_phone_last4'
    or p_verification_outcome not in ('matched','manual_review')
  ) then raise exception 'RAFFLE_PICKUP_VERIFICATION_REQUIRED'; end if;
  if p_to_status<>'pickup_completed' and (
    p_verification_method is not null or p_verification_outcome is not null
  ) then raise exception 'RAFFLE_PICKUP_VERIFICATION_NOT_APPLICABLE'; end if;
  if p_verification_outcome='manual_review' then
    insert into public.benefit_fulfillment_events(
      fulfillment_id,from_status,to_status,operator_memo,verification_method,
      verification_outcome,actor_app_user_id,actor_admin_allowlist_id,correlation_id
    ) values(
      fulfillment.id,fulfillment.status,fulfillment.status,btrim(p_operator_memo),
      p_verification_method,p_verification_outcome,p_actor_app_user_id,
      p_actor_admin_allowlist_id,p_correlation_id);
    return jsonb_build_object(
      'winnerId',p_winner_id,'method',fulfillment.method,'status',fulfillment.status,
      'revision',fulfillment.revision,'manualReview',true);
  end if;
  update public.benefit_fulfillments set status=p_to_status,revision=revision+1
    where id=fulfillment.id;
  insert into public.benefit_fulfillment_events(
    fulfillment_id,from_status,to_status,carrier,tracking_number,operator_memo,
    verification_method,verification_outcome,actor_app_user_id,
    actor_admin_allowlist_id,correlation_id
  ) values(
    fulfillment.id,fulfillment.status,p_to_status,
    nullif(btrim(coalesce(p_carrier,'')),''),
    nullif(btrim(coalesce(p_tracking_number,'')),''),btrim(p_operator_memo),
    p_verification_method,p_verification_outcome,p_actor_app_user_id,
    p_actor_admin_allowlist_id,p_correlation_id);
  return jsonb_build_object(
    'winnerId',p_winner_id,'method',fulfillment.method,'status',p_to_status,
    'revision',fulfillment.revision+1);
end;
$$;

create or replace function public.phase5_notify_fulfillment_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare winner public.benefit_draw_winners%rowtype; fulfillment public.benefit_fulfillments%rowtype;
begin
  if new.verification_outcome='manual_review'
    or new.to_status not in ('shipping_in_transit','shipping_completed','pickup_available',
      'pickup_completed','digital_delivered') then return new; end if;
  select * into strict fulfillment from public.benefit_fulfillments where id=new.fulfillment_id;
  select * into strict winner from public.benefit_draw_winners where id=fulfillment.winner_id;
  if not exists(select 1 from public.benefit_draw_publications publication
    where publication.draw_id=winner.draw_id) then return new; end if;
  perform public.insert_action_required_notification(
    winner.app_user_id,'fulfillment_meaningful_update',
    'fulfillment_meaningful_update:'||new.fulfillment_id::text||':'||new.id::text,
    null,winner.benefit_id,'/benefits/'||winner.benefit_id::text,
    jsonb_build_object('title','Benefit 진행 상태 변경',
      'detail','최신 수령 상태를 확인해 주세요.','fulfillmentStatus',new.to_status::text),
    new.created_at);
  return new;
end;
$$;

create function public.close_admin_benefit_fulfillment_unclaimed(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_expected_revision integer,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare fulfillment public.benefit_fulfillments%rowtype; v_now timestamptz:=pg_catalog.statement_timestamp();
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into fulfillment from public.benefit_fulfillments
    where winner_id=p_winner_id for update;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if not exists(select 1 from public.benefit_draw_winners winner
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.id=p_winner_id) then raise exception 'PHASE4_REWARD_NOT_PUBLISHED'; end if;
  if p_expected_revision is null or fulfillment.revision<>p_expected_revision then
    raise exception 'PHASE4_FULFILLMENT_REVISION_CONFLICT';
  end if;
  if fulfillment.claim_disposition<>'active' then raise exception 'RAFFLE_CLAIM_CLOSED'; end if;
  if fulfillment.status in ('shipping_completed','pickup_completed','digital_delivered') then
    raise exception 'RAFFLE_COMPLETED_CLAIM_CANNOT_CLOSE';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'RAFFLE_UNCLAIMED_REASON_REQUIRED';
  end if;
  update public.benefit_fulfillments set
    claim_disposition='unclaimed',closed_at=v_now,claim_closed_reason=btrim(p_reason),
    claim_closed_by_app_user_id=p_actor_app_user_id,
    claim_closed_by_admin_allowlist_id=p_actor_admin_allowlist_id,
    revision=revision+1
  where id=fulfillment.id;
  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_fulfillment.closed_unclaimed',
    'benefit_fulfillment',fulfillment.id::text,p_correlation_id,
    jsonb_build_object('winnerId',p_winner_id,'status',fulfillment.status,
      'reason',btrim(p_reason),'closedAt',v_now));
  return jsonb_build_object(
    'winnerId',p_winner_id,'method',fulfillment.method,'status',fulfillment.status,
    'revision',fulfillment.revision+1,'claimDisposition','unclaimed','closedAt',v_now);
end;
$$;

alter function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean)
  rename to get_admin_benefit_winner_without_claim_timing;
create function public.get_admin_benefit_winner(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_reveal boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fulfillment public.benefit_fulfillments%rowtype;
begin
  result:=public.get_admin_benefit_winner_without_claim_timing(
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_winner_id,p_reveal);
  select * into strict fulfillment from public.benefit_fulfillments where winner_id=p_winner_id;
  return result||jsonb_build_object(
    'recipientDeadlineAt',fulfillment.recipient_deadline_at,
    'claimDisposition',fulfillment.claim_disposition,'closedAt',fulfillment.closed_at,
    'claimClosedReason',fulfillment.claim_closed_reason,
    'fulfillmentPolicyVersion',fulfillment.fulfillment_policy_version);
end;
$$;

create table public.benefit_pickup_roster_access_audits (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  purpose text not null check(length(btrim(purpose)) between 10 and 1000),
  row_count integer not null check(row_count>=0),
  roster_version text not null,
  accessed_at timestamptz not null default pg_catalog.statement_timestamp()
);
alter table public.benefit_pickup_roster_access_audits enable row level security;
alter table public.benefit_pickup_roster_access_audits force row level security;
revoke all on table public.benefit_pickup_roster_access_audits from public,anon,authenticated,service_role;
create trigger benefit_pickup_roster_access_audits_reject_update_delete
before update or delete on public.benefit_pickup_roster_access_audits for each row
execute function public.reject_benefit_economy_history_mutation();
create trigger benefit_pickup_roster_access_audits_reject_truncate
before truncate on public.benefit_pickup_roster_access_audits for each statement
execute function public.reject_benefit_economy_history_truncate();

create function public.get_admin_benefit_pickup_roster(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_purpose text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role public.admin_role; v_generated_at timestamptz:=pg_catalog.statement_timestamp();
  v_version text; v_items jsonb; v_count integer;
begin
  v_role:=public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if v_role='viewer' then raise exception 'PHASE4_RECIPIENT_REVEAL_FORBIDDEN'; end if;
  if length(btrim(coalesce(p_purpose,''))) not between 10 and 1000 then
    raise exception 'RAFFLE_ROSTER_PURPOSE_REQUIRED';
  end if;
  if not exists(select 1 from public.benefit_draw_publications publication
    where publication.campaign_id=p_campaign_id) then
    raise exception 'PHASE4_REWARD_NOT_PUBLISHED';
  end if;
  if exists(
    select 1 from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    join public.benefit_recipient_private recipient on recipient.winner_id=winner.id
    where winner.campaign_id=p_campaign_id and fulfillment.method='on_site_pickup'
      and fulfillment.claim_disposition='active'
      and length(regexp_replace(recipient.phone,'[^0-9]','','g'))<4
  ) then raise exception 'RAFFLE_ROSTER_RECIPIENT_INVALID'; end if;
  select encode(extensions.digest(coalesce(string_agg(
      winner.id::text||':'||fulfillment.revision::text||':'||fulfillment.status::text,
      '|' order by winner.id),''),'sha256'),'hex'),count(*)::integer
  into v_version,v_count
  from public.benefit_draw_winners winner
  join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
  join public.benefit_recipient_private recipient on recipient.winner_id=winner.id
  where winner.campaign_id=p_campaign_id and fulfillment.method='on_site_pickup'
    and fulfillment.claim_disposition='active';
  select coalesce(jsonb_agg(jsonb_build_object(
    'winnerId',winner.id,'name',recipient.name,
    'phoneLast4',right(regexp_replace(recipient.phone,'[^0-9]','','g'),4),
    'fulfillmentStatus',fulfillment.status,'benefitId',winner.benefit_id,
    'benefitTitle',coalesce(ko.title,en.title,benefit.slug)
  ) order by coalesce(ko.title,en.title,benefit.slug),recipient.name,winner.id),'[]'::jsonb)
  into v_items
  from public.benefit_draw_winners winner
  join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
  join public.benefit_recipient_private recipient on recipient.winner_id=winner.id
  join public.benefits benefit on benefit.id=winner.benefit_id
  left join public.benefit_localizations ko on ko.benefit_id=benefit.id and ko.locale='ko'
  left join public.benefit_localizations en on en.benefit_id=benefit.id and en.locale='en'
  where winner.campaign_id=p_campaign_id and fulfillment.method='on_site_pickup'
    and fulfillment.claim_disposition='active';
  insert into public.benefit_pickup_roster_access_audits(
    campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id,
    purpose,row_count,roster_version,accessed_at
  ) values(
    p_campaign_id,p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,
    btrim(p_purpose),v_count,v_version,v_generated_at);
  return jsonb_build_object(
    'rosterVersion',v_version,'generatedAt',v_generated_at,'items',v_items);
end;
$$;

create function public.enqueue_due_benefit_recipient_reminders(
  p_now timestamptz default pg_catalog.now()
) returns integer language plpgsql security definer set search_path='' as $$
declare due record; v_count integer:=0; v_source text;
begin
  for due in
    select winner.id winner_id,winner.app_user_id,winner.benefit_id,
      fulfillment.fulfillment_policy_version,fulfillment.recipient_deadline_at
    from public.benefit_draw_winners winner
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    where fulfillment.claim_disposition='active'
      and fulfillment.fulfillment_policy_version is not null
      and fulfillment.recipient_deadline_at>p_now
      and fulfillment.recipient_deadline_at<=p_now+interval '24 hours'
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  loop
    v_source:='recipient_deadline_reminder:'||due.winner_id::text||':'
      ||due.fulfillment_policy_version||':'||due.recipient_deadline_at::text;
    if not exists(select 1 from public.fan_notifications notification
      where notification.app_user_id=due.app_user_id and notification.source_key=v_source) then
      perform public.insert_action_required_notification(
        due.app_user_id,'recipient_information_required',v_source,null,due.benefit_id,
        '/benefits/'||due.benefit_id::text,
        jsonb_build_object('title','수령 정보 입력 마감 임박',
          'detail','수령 정보를 24시간 안에 입력해 주세요.',
          'recipientDeadlineAt',due.recipient_deadline_at),p_now);
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

alter function public.notification_delivery_is_eligible(uuid,timestamptz)
  rename to notification_delivery_is_eligible_before_raffle_recipient_reminder;
create function public.notification_delivery_is_eligible(
  p_notification_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.notification_delivery_is_eligible_before_raffle_recipient_reminder(
    p_notification_id,p_at)
  and case when notification.source_key like 'recipient_deadline_reminder:%' then exists(
    select 1 from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
      and notification.source_key='recipient_deadline_reminder:'||winner.id::text||':'
        ||fulfillment.fulfillment_policy_version||':'||fulfillment.recipient_deadline_at::text
      and fulfillment.claim_disposition='active'
      and fulfillment.recipient_deadline_at>p_at
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  ) else true end
  from public.fan_notifications notification where notification.id=p_notification_id;
$$;

alter function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  rename to email_notification_delivery_is_eligible_before_raffle_recipient_reminder;
create function public.email_notification_delivery_is_eligible(
  p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible_before_raffle_recipient_reminder(
    p_notification_id,p_channel_id,p_at)
  and case when notification.source_key like 'recipient_deadline_reminder:%' then exists(
    select 1 from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
      and notification.source_key='recipient_deadline_reminder:'||winner.id::text||':'
        ||fulfillment.fulfillment_policy_version||':'||fulfillment.recipient_deadline_at::text
      and fulfillment.claim_disposition='active'
      and fulfillment.recipient_deadline_at>p_at
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  ) else true end
  from public.fan_notifications notification where notification.id=p_notification_id;
$$;

create or replace function public.purge_due_benefit_recipient_private(
  p_now timestamptz default pg_catalog.now()
) returns integer language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  with due as (
    select recipient.winner_id
    from public.benefit_recipient_private recipient
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=recipient.winner_id
    left join lateral(
      select event.created_at from public.benefit_fulfillment_events event
      where event.fulfillment_id=fulfillment.id and event.to_status=fulfillment.status
        and event.to_status in ('shipping_completed','pickup_completed')
      order by event.created_at desc,event.id desc limit 1
    ) completed on true
    where (fulfillment.status in ('shipping_completed','pickup_completed')
        and completed.created_at<=p_now-interval '30 days')
      or (fulfillment.claim_disposition='unclaimed'
        and fulfillment.closed_at<=p_now-interval '30 days')
    order by coalesce(fulfillment.closed_at,completed.created_at),recipient.winner_id
    for update of recipient skip locked limit 100
  ), deleted as (
    delete from public.benefit_recipient_private recipient using due
    where recipient.winner_id=due.winner_id returning recipient.winner_id
  )
  insert into public.benefit_recipient_access_audits(winner_id,access_type,accessed_at)
  select winner_id,'purged',p_now from deleted;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;

-- Every public entry point is service-only; inner wrappers/helpers are not callable
-- even by service_role and can only run through their security-definer parents.
revoke all on function public.configure_admin_raffle_fulfillment_policy(uuid,uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.get_admin_raffle_fulfillment_policy(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.enter_owned_benefit_v2(uuid,uuid,uuid,integer,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.get_owned_benefit_entry_state(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_public_raffles(text,public.content_locale,timestamptz) from public,anon,authenticated;
revoke all on function public.get_owned_benefit_recipient(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_owned_benefit_recipient_v2(uuid,uuid,uuid,text,boolean,text,text,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_owned_raffle_result(uuid,uuid,public.content_locale) from public,anon,authenticated;
revoke all on function public.get_owned_raffles(uuid,public.content_locale,text,integer) from public,anon,authenticated;
revoke all on function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) from public,anon,authenticated;
revoke all on function public.transition_admin_benefit_fulfillment_v2(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.close_admin_benefit_fulfillment_unclaimed(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.get_admin_benefit_pickup_roster(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.enqueue_due_benefit_recipient_reminders(timestamptz) from public,anon,authenticated;
revoke all on function public.publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.notification_delivery_is_eligible(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz) from public,anon,authenticated;

grant execute on function public.configure_admin_raffle_fulfillment_policy(uuid,uuid,uuid,uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.get_admin_raffle_fulfillment_policy(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.enter_owned_benefit_v2(uuid,uuid,uuid,integer,text,boolean,timestamptz) to service_role;
grant execute on function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz) to service_role;
grant execute on function public.get_owned_benefit_entry_state(uuid,uuid) to service_role;
grant execute on function public.get_public_raffles(text,public.content_locale,timestamptz) to service_role;
grant execute on function public.get_owned_benefit_recipient(uuid,uuid) to service_role;
grant execute on function public.save_owned_benefit_recipient_v2(uuid,uuid,uuid,text,boolean,text,text,text,text,text,text,text,integer) to service_role;
grant execute on function public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text) to service_role;
grant execute on function public.get_owned_raffle_result(uuid,uuid,public.content_locale) to service_role;
grant execute on function public.get_owned_raffles(uuid,public.content_locale,text,integer) to service_role;
grant execute on function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) to service_role;
grant execute on function public.transition_admin_benefit_fulfillment_v2(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text,text,text) to service_role;
grant execute on function public.close_admin_benefit_fulfillment_unclaimed(uuid,uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.get_admin_benefit_pickup_roster(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.enqueue_due_benefit_recipient_reminders(timestamptz) to service_role;
grant execute on function public.publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.notification_delivery_is_eligible(uuid,timestamptz) to service_role;
grant execute on function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz) to service_role;

revoke all on function public.raffle_fulfillment_policy_json(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.build_owned_raffle_result(uuid,uuid,uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.enter_owned_benefit_without_fulfillment_policy(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.publish_admin_benefit_draw_without_recipient_deadlines(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_benefit_entry_state_without_fulfillment_policy(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_owned_benefit_recipient_without_fulfillment_policy(uuid,uuid,uuid,text,boolean,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.transition_admin_benefit_fulfillment_without_claim_guard(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_benefit_winner_without_claim_timing(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.notification_delivery_is_eligible_before_raffle_recipient_reminder(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.email_notification_delivery_is_eligible_before_raffle_recipient_reminder(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
