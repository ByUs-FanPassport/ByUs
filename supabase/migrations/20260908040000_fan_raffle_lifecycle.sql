-- Raffles have an explicit lifecycle. A draw is an internal immutable result;
-- publication is the one boundary that exposes winners and starts fulfillment.

alter table public.live_benefit_campaigns
  alter column entry_opens_at drop not null,
  alter column entry_closes_at drop not null,
  add column public_teaser boolean not null default false,
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

-- Draft Benefits may carry curated teaser copy before claim dates are known.
-- They remain unclaimable until publication, which still requires a complete window.
alter table public.benefits
  alter column claim_opens_at drop not null,
  alter column claim_closes_at drop not null,
  drop constraint benefits_claim_window_ordered,
  add constraint benefits_claim_window_ordered check (
    claim_opens_at is null or claim_closes_at is null or claim_opens_at < claim_closes_at
  ),
  add constraint benefits_claim_lifecycle_shape check (
    publication_status='draft'
    or (publication_status='published' and claim_opens_at is not null and claim_closes_at is not null)
  );

alter table public.live_benefit_campaign_items
  add column teaser_image_url text,
  add constraint live_benefit_campaign_item_teaser_image_safe check (
    teaser_image_url is null or (
      teaser_image_url=btrim(teaser_image_url)
      and teaser_image_url !~ '[@[:space:]]'
      and (teaser_image_url ~ '^/[^/[:space:]][^[:space:]]*$'
        or teaser_image_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/[^[:space:]]+$')
    )
  );

alter table public.live_benefit_campaigns
  drop constraint live_benefit_campaign_window_ordered,
  drop constraint live_benefit_campaign_publication_shape,
  add constraint live_benefit_campaign_window_ordered check (
    entry_opens_at is null or entry_closes_at is null or entry_opens_at < entry_closes_at
  ),
  add constraint live_benefit_campaign_lifecycle_shape check (
    (status='draft' and published_at is null and cancelled_at is null)
    or (status='published' and published_at is not null
        and entry_opens_at is not null and entry_closes_at is not null
        and ((cancelled_at is null and cancellation_reason is null)
          or (cancelled_at is not null and length(btrim(cancellation_reason)) between 10 and 1000)))
  );

create table public.benefit_entry_refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null unique references public.benefit_ticket_entries(id) on delete restrict,
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  ticket_ledger_id uuid not null unique references public.fan_ticket_ledger(id) on delete restrict,
  refunded_at timestamptz not null default pg_catalog.now(),
  unique(id,campaign_id,app_user_id)
);

create table public.benefit_draw_publications (
  draw_id uuid primary key references public.benefit_draws(id) on delete restrict,
  campaign_id uuid not null unique references public.live_benefit_campaigns(id) on delete restrict,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  published_at timestamptz not null default pg_catalog.now(),
  unique(draw_id,campaign_id),
  foreign key(draw_id,campaign_id) references public.benefit_draws(id,campaign_id) on delete restrict
);

do $$ declare t text; begin
  foreach t in array array['benefit_entry_refunds','benefit_draw_publications'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.reject_benefit_economy_history_mutation()',t||'_reject_update_delete',t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.reject_benefit_economy_history_truncate()',t||'_reject_truncate',t);
  end loop;
end $$;
alter table public.benefit_entry_refunds enable row level security;
alter table public.benefit_entry_refunds force row level security;
alter table public.benefit_draw_publications enable row level security;
alter table public.benefit_draw_publications force row level security;
revoke all on table public.benefit_entry_refunds,public.benefit_draw_publications from public,anon,authenticated,service_role;

-- Existing draws were already visible and notified, so preserve that fact.
insert into public.benefit_draw_publications(
  draw_id,campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at
)
select d.id,d.campaign_id,d.actor_app_user_id,d.actor_admin_allowlist_id,d.correlation_id,d.executed_at
from public.benefit_draws d on conflict(draw_id) do nothing;

alter function public.get_admin_benefit_campaigns(uuid,uuid) rename to get_admin_benefit_campaigns_base;
create function public.get_admin_benefit_campaigns(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_set(item,'{benefits}',coalesce((
    select jsonb_agg(benefit_item || jsonb_build_object('teaserImageUrl',campaign_item.teaser_image_url)
      order by (benefit_item->>'priority')::integer,(benefit_item->>'benefitId')::uuid)
    from jsonb_array_elements(item->'benefits') benefit_item
    join public.live_benefit_campaign_items campaign_item
      on campaign_item.campaign_id=c.id and campaign_item.benefit_id=(benefit_item->>'benefitId')::uuid
  ),'[]'::jsonb)) || jsonb_build_object(
    'publicTeaser',c.public_teaser,'cancelledAt',c.cancelled_at,
    'cancellationReason',c.cancellation_reason,
    'drawPublishedAt',(select p.published_at from public.benefit_draws d join public.benefit_draw_publications p on p.draw_id=d.id where d.campaign_id=c.id)
  )),'[]'::jsonb)
  from jsonb_array_elements(public.get_admin_benefit_campaigns_base(p_actor_app_user_id,p_actor_admin_allowlist_id)) item
  join public.live_benefit_campaigns c on c.id=(item->>'id')::uuid;
$$;

create function public.save_admin_benefit_campaign(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_expected_revision integer,p_live_event_id uuid,
  p_entry_opens_at timestamptz,p_entry_closes_at timestamptz,p_benefits jsonb,p_public_teaser boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  v_id:=public.save_admin_benefit_campaign(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_campaign_id,p_expected_revision,p_live_event_id,p_entry_opens_at,p_entry_closes_at,p_benefits);
  update public.live_benefit_campaign_items item set teaser_image_url=input."teaserImageUrl"
  from jsonb_to_recordset(p_benefits) as input("benefitId" uuid,"teaserImageUrl" text)
  where item.campaign_id=v_id and item.benefit_id=input."benefitId";
  update public.live_benefit_campaigns set public_teaser=coalesce(p_public_teaser,false) where id=v_id;
  return v_id;
end $$;

alter function public.get_owned_benefit_entry_state(uuid,uuid) rename to get_owned_benefit_entry_state_base;
create function public.get_owned_benefit_entry_state(p_app_user_id uuid,p_benefit_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.get_owned_benefit_entry_state_base(p_app_user_id,p_benefit_id);
  if result is not null and exists(
    select 1 from public.live_benefit_campaigns c
    where c.id=(result->>'campaignId')::uuid and c.cancelled_at is not null
  ) then result:=jsonb_set(result,'{canEnter}','false'::jsonb); end if;
  return result;
end $$;

create function public.get_public_raffles(
  p_celebrity_slug text,p_locale public.content_locale,p_now timestamptz default pg_catalog.now()
) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('raffles',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'benefitId',i.benefit_id,
    'title',coalesce(l.title,b.slug),
    'summary',coalesce(l.summary,b.slug),
    'imageUrl',i.teaser_image_url,
    'winnerQuantity',i.winner_quantity,
    'status',case when c.cancelled_at is not null then 'cancelled'
      when c.status='draft' then 'preparing'
      when p_now<c.entry_opens_at then 'preparing'
      when p_now<c.entry_closes_at then 'open' else 'closed' end,
    'entryOpensAt',c.entry_opens_at,
    'entryClosesAt',c.entry_closes_at,
    'fulfillmentMethod',i.fulfillment_method,
    'perFanTicketLimit',i.per_fan_ticket_limit
  ) order by c.entry_opens_at nulls last,i.priority,c.id),'[]'::jsonb))
  from public.live_benefit_campaigns c
  join public.live_events e on e.id=c.live_event_id
  join public.celebrities celebrity on celebrity.id=e.celebrity_id and celebrity.slug=p_celebrity_slug
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  join public.benefits b on b.id=i.benefit_id
  left join public.benefit_localizations l on l.benefit_id=b.id and l.locale=p_locale
  where celebrity.status='published' and celebrity.archived_at is null
    and e.publication_status='published' and e.archived_at is null
    and b.archived_at is null
    and ((c.status='published' and b.publication_status='published')
      or (c.status='draft' and c.public_teaser and b.publication_status='draft'));
$$;

create function public.post_benefit_entry_refund(p_entry_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.benefit_ticket_entries%rowtype; original public.fan_ticket_ledger%rowtype;
  existing public.fan_ticket_ledger%rowtype; v_celebrity uuid; v_balance bigint; v_sequence bigint; inserted public.fan_ticket_ledger%rowtype;
begin
  select * into strict entry from public.benefit_ticket_entries where id=p_entry_id;
  select * into strict original from public.fan_ticket_ledger where id=entry.ticket_ledger_id;
  select celebrity_id into strict v_celebrity from public.benefits where id=entry.benefit_id;
  if original.app_user_id<>entry.app_user_id or original.celebrity_id<>v_celebrity
     or original.entry_kind<>'debit' or original.amount<>-entry.ticket_amount
     or original.source_type<>'benefit_entry' or original.source_id<>entry.id then
    raise exception 'PHASE4_BENEFIT_REFUND_SOURCE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase1:ticket:key:'||p_idempotency_key::text,0));
  select * into existing from public.fan_ticket_ledger where idempotency_key=p_idempotency_key;
  if found then
    if existing.app_user_id<>entry.app_user_id or existing.celebrity_id<>v_celebrity
       or existing.entry_kind<>'credit' or existing.amount<>entry.ticket_amount
       or existing.source_type<>'benefit_entry_refund' or existing.source_id<>entry.id then
      raise exception 'PHASE1_TICKET_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    return jsonb_build_object('entryId',existing.id,'amount',existing.amount,'balance',existing.resulting_balance,'replayed',true,'createdAt',existing.created_at);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase1:ticket:balance:'||entry.app_user_id::text||':'||v_celebrity::text,0));
  select resulting_balance,owner_sequence+1 into v_balance,v_sequence from public.fan_ticket_ledger
    where app_user_id=entry.app_user_id and celebrity_id=v_celebrity order by owner_sequence desc limit 1;
  v_balance:=coalesce(v_balance,0)+entry.ticket_amount; v_sequence:=coalesce(v_sequence,1);
  insert into public.fan_ticket_ledger(app_user_id,celebrity_id,entry_kind,amount,source_type,source_id,idempotency_key,policy_version,setting_revision,reward_setting_revision_id,owner_sequence,resulting_balance)
    values(entry.app_user_id,v_celebrity,'credit',entry.ticket_amount,'benefit_entry_refund',entry.id,p_idempotency_key,original.policy_version,null,null,v_sequence,v_balance)
    returning * into inserted;
  return jsonb_build_object('entryId',inserted.id,'amount',inserted.amount,'balance',inserted.resulting_balance,'replayed',false,'createdAt',inserted.created_at);
end $$;

create or replace function public.enter_owned_benefit(
  p_app_user_id uuid,p_benefit_id uuid,p_idempotency_key uuid,p_ticket_amount integer,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.benefit_ticket_entries%rowtype; c public.live_benefit_campaigns%rowtype;
  v_limit integer; v_celebrity uuid; v_benefit_status public.content_status;
  v_total bigint; v_next bigint; v_policy integer; v_id uuid:=extensions.gen_random_uuid(); ledger jsonb;
begin
  if p_app_user_id is null or p_benefit_id is null or p_idempotency_key is null or p_ticket_amount is null or p_ticket_amount<=0 then raise exception 'PHASE4_BENEFIT_ENTRY_INVALID'; end if;
  select campaign.* into c from public.live_benefit_campaigns campaign
    join public.live_benefit_campaign_items item on item.campaign_id=campaign.id
    where item.benefit_id=p_benefit_id and campaign.status='published'
    order by campaign.entry_closes_at desc,campaign.id desc limit 1 for update of campaign;
  if not found then raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0));
  select * into e from public.benefit_ticket_entries where idempotency_key=p_idempotency_key;
  if found then
    if e.app_user_id<>p_app_user_id or e.benefit_id<>p_benefit_id or e.ticket_amount<>p_ticket_amount then raise exception 'PHASE4_BENEFIT_ENTRY_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    select jsonb_build_object('entryId',e.id,'benefitId',e.benefit_id,'campaignId',e.campaign_id,'ticketAmount',e.ticket_amount,'benefitTicketTotal',e.benefit_ticket_total,'perFanTicketLimit',e.per_fan_ticket_limit,'remainingBenefitTickets',case when e.per_fan_ticket_limit is null then null else e.per_fan_ticket_limit-e.benefit_ticket_total end,'ticketLedgerId',e.ticket_ledger_id,'resultingBalance',l.resulting_balance,'replayed',true) into ledger from public.fan_ticket_ledger l where l.id=e.ticket_ledger_id;
    return ledger;
  end if;
  select item.per_fan_ticket_limit,b.celebrity_id,b.publication_status into v_limit,v_celebrity,v_benefit_status
    from public.live_benefit_campaign_items item join public.benefits b on b.id=item.benefit_id
    where item.campaign_id=c.id and item.benefit_id=p_benefit_id;
  if c.status<>'published' or c.cancelled_at is not null or v_benefit_status<>'published' then raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE'; end if;
  if c.entry_opens_at is null or c.entry_closes_at is null or p_now<c.entry_opens_at or p_now>=c.entry_closes_at then raise exception 'PHASE4_BENEFIT_ENTRY_WINDOW_CLOSED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase4:benefit-entry:aggregate:'||p_app_user_id::text||':'||p_benefit_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase1:ticket:balance:'||p_app_user_id::text||':'||v_celebrity::text,0));
  select coalesce(sum(ticket_amount),0) into v_total from public.benefit_ticket_entries where app_user_id=p_app_user_id and campaign_id=c.id and benefit_id=p_benefit_id;
  v_next:=v_total+p_ticket_amount;
  if v_limit is not null and v_next>v_limit then raise exception 'PHASE4_BENEFIT_ENTRY_LIMIT_REACHED' using errcode='23514'; end if;
  select policy_version into v_policy from public.reward_policy_activation where singleton;
  if v_policy is null then raise exception 'PHASE4_BENEFIT_ENTRY_POLICY_UNAVAILABLE'; end if;
  ledger:=public.post_fan_ticket_entry(p_app_user_id,v_celebrity,'debit',-p_ticket_amount::bigint,'benefit_entry',v_id,p_idempotency_key,v_policy,null,null);
  insert into public.benefit_ticket_entries(id,idempotency_key,campaign_id,benefit_id,app_user_id,ticket_amount,ticket_ledger_id,benefit_ticket_total,per_fan_ticket_limit)
    values(v_id,p_idempotency_key,c.id,p_benefit_id,p_app_user_id,p_ticket_amount,(ledger->>'entryId')::uuid,v_next::integer,v_limit) returning * into e;
  return jsonb_build_object('entryId',e.id,'benefitId',e.benefit_id,'campaignId',e.campaign_id,'ticketAmount',e.ticket_amount,'benefitTicketTotal',e.benefit_ticket_total,'perFanTicketLimit',e.per_fan_ticket_limit,'remainingBenefitTickets',case when e.per_fan_ticket_limit is null then null else e.per_fan_ticket_limit-e.benefit_ticket_total end,'ticketLedgerId',e.ticket_ledger_id,'resultingBalance',(ledger->>'balance')::bigint,'replayed',false);
end $$;

create function public.cancel_admin_benefit_campaign(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_expected_revision integer,p_reason text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.live_benefit_campaigns%rowtype; entry public.benefit_ticket_entries%rowtype;
  v_celebrity uuid; v_policy integer; v_refund_id uuid; ledger jsonb; v_count integer:=0; v_total bigint:=0;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into c from public.live_benefit_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'PHASE4_BENEFIT_CAMPAIGN_NOT_FOUND'; end if;
  if c.cancelled_at is not null then return jsonb_build_object('campaignId',c.id,'refundCount',(select count(*) from public.benefit_entry_refunds where campaign_id=c.id),'refundedTickets',(select coalesce(sum(e.ticket_amount),0) from public.benefit_entry_refunds r join public.benefit_ticket_entries e on e.id=r.entry_id where r.campaign_id=c.id),'replayed',true); end if;
  if c.revision<>p_expected_revision then raise exception 'PHASE4_BENEFIT_CAMPAIGN_REVISION_CONFLICT'; end if;
  if c.status<>'published' or exists(select 1 from public.benefit_draws where campaign_id=c.id) then raise exception 'PHASE4_BENEFIT_CAMPAIGN_CANNOT_CANCEL'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'PHASE4_BENEFIT_CAMPAIGN_CANCEL_REASON_REQUIRED'; end if;
  select policy_version into v_policy from public.reward_policy_activation where singleton;
  update public.live_benefit_campaigns set cancelled_at=p_now,cancellation_reason=btrim(p_reason),revision=revision+1 where id=c.id;
  for entry in select e.* from public.benefit_ticket_entries e join public.benefits b on b.id=e.benefit_id where e.campaign_id=c.id order by e.app_user_id,b.celebrity_id,e.id loop
    if not exists(select 1 from public.benefit_entry_refunds r where r.entry_id=entry.id) then
      select b.celebrity_id into v_celebrity from public.benefits b where b.id=entry.benefit_id;
      v_refund_id:=extensions.gen_random_uuid();
      ledger:=public.post_benefit_entry_refund(entry.id,v_refund_id);
      insert into public.benefit_entry_refunds(id,entry_id,campaign_id,app_user_id,ticket_ledger_id,refunded_at) values(v_refund_id,entry.id,c.id,entry.app_user_id,(ledger->>'entryId')::uuid,p_now);
      v_count:=v_count+1; v_total:=v_total+entry.ticket_amount;
    end if;
  end loop;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_campaign.cancelled','live_benefit_campaign',c.id::text,p_correlation_id,jsonb_build_object('refundCount',v_count,'refundedTickets',v_total,'reason',btrim(p_reason)));
  return jsonb_build_object('campaignId',c.id,'refundCount',v_count,'refundedTickets',v_total,'replayed',false);
end $$;

-- New draws remain internal. The fulfillment trigger is also held until publication.
create or replace function public.phase5_notify_fulfillment_created()
returns trigger language plpgsql security definer set search_path='' as $$
declare w public.benefit_draw_winners%rowtype;
begin
  select * into strict w from public.benefit_draw_winners where id=new.winner_id;
  if not exists(select 1 from public.benefit_draw_publications p where p.draw_id=w.draw_id) then return new; end if;
  if new.status='information_required' then perform public.insert_action_required_notification(w.app_user_id,'recipient_information_required','recipient_information_required:'||new.winner_id::text||':'||new.revision::text,null,w.benefit_id,'/benefits/'||w.benefit_id::text,jsonb_build_object('title','수령 정보 필요','detail','Benefit 수령 정보를 입력해 주세요.','fulfillmentStatus',new.status::text),new.created_at); end if;
  return new;
end $$;

create or replace function public.phase5_notify_benefit_winner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.benefit_draw_publications p where p.draw_id=new.draw_id) then return new; end if;
  perform public.insert_action_required_notification(
    new.app_user_id,'benefit_won','benefit_won:'||new.id::text||':1',null,
    new.benefit_id,'/benefits/'||new.benefit_id::text,
    jsonb_build_object('title','Benefit 당첨','detail','당첨된 Benefit을 확인해 주세요.'),new.selected_at
  );
  return new;
end $$;

create or replace function public.phase5_notify_fulfillment_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare winner public.benefit_draw_winners%rowtype; fulfillment public.benefit_fulfillments%rowtype;
begin
  if new.to_status not in ('shipping_in_transit','shipping_completed','pickup_available','pickup_completed','digital_delivered') then return new; end if;
  select * into strict fulfillment from public.benefit_fulfillments where id=new.fulfillment_id;
  select * into strict winner from public.benefit_draw_winners where id=fulfillment.winner_id;
  if not exists(select 1 from public.benefit_draw_publications p where p.draw_id=winner.draw_id) then return new; end if;
  perform public.insert_action_required_notification(winner.app_user_id,'fulfillment_meaningful_update','fulfillment_meaningful_update:'||new.fulfillment_id::text||':'||new.id::text,null,winner.benefit_id,'/benefits/'||winner.benefit_id::text,jsonb_build_object('title','Benefit 진행 상태 변경','detail','최신 수령 상태를 확인해 주세요.','fulfillmentStatus',new.to_status::text),new.created_at);
  return new;
end $$;

alter function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  rename to email_notification_delivery_is_eligible_base;
create function public.email_notification_delivery_is_eligible(
  p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible_base(p_notification_id,p_channel_id,p_at)
    and case
      when notification.kind='benefit_available' and notification.source_key like 'benefit-draw:%' then exists(
        select 1 from public.benefit_draw_winners w join public.benefit_draw_publications p on p.draw_id=w.draw_id
        where w.app_user_id=notification.app_user_id and w.benefit_id=notification.benefit_id
          and notification.source_key='benefit-draw:'||w.draw_id::text||':'||w.benefit_id::text)
      when notification.kind='benefit_won' then exists(
        select 1 from public.benefit_draw_winners w join public.benefit_draw_publications p on p.draw_id=w.draw_id
        where w.app_user_id=notification.app_user_id and w.benefit_id=notification.benefit_id
          and notification.source_key='benefit_won:'||w.id::text||':1')
      when notification.kind='recipient_information_required' then exists(
        select 1 from public.benefit_draw_winners w
        join public.benefit_draw_publications p on p.draw_id=w.draw_id
        join public.benefit_fulfillments f on f.winner_id=w.id
        where w.app_user_id=notification.app_user_id and w.benefit_id=notification.benefit_id
          and notification.source_key='recipient_information_required:'||w.id::text||':'||f.revision::text)
      when notification.kind='fulfillment_meaningful_update' then exists(
        select 1 from public.benefit_draw_winners w
        join public.benefit_draw_publications p on p.draw_id=w.draw_id
        join public.benefit_fulfillments f on f.winner_id=w.id
        left join public.benefit_fulfillment_events e on e.fulfillment_id=f.id
          and notification.source_key='fulfillment_meaningful_update:'||e.fulfillment_id::text||':'||e.id::text
        where w.app_user_id=notification.app_user_id and w.benefit_id=notification.benefit_id
          and (e.id is not null
            or notification.source_key='fulfillment_meaningful_update:'||f.id::text||':'||f.revision::text))
      else true end
  from public.fan_notifications notification where notification.id=p_notification_id;
$$;

create function public.suppress_unpublished_benefit_draw_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind='benefit_available' and new.source_key like 'benefit-draw:%'
     and exists(
       select 1 from public.benefit_draw_winners w
       where w.app_user_id=new.app_user_id and w.benefit_id=new.benefit_id
         and new.source_key='benefit-draw:'||w.draw_id::text||':'||w.benefit_id::text
         and not exists(select 1 from public.benefit_draw_publications p where p.draw_id=w.draw_id)
     ) then return null; end if;
  return new;
end $$;
create trigger fan_notifications_suppress_unpublished_benefit_draw
before insert on public.fan_notifications for each row
execute function public.suppress_unpublished_benefit_draw_notification();

alter function public.execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz) rename to execute_admin_benefit_draw_unpublished;
create function public.execute_admin_benefit_draw(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_campaign_id uuid,p_idempotency_key uuid,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.live_benefit_campaigns%rowtype;
begin
  select * into c from public.live_benefit_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'PHASE4_BENEFIT_DRAW_NOT_FOUND'; end if;
  if c.cancelled_at is not null then raise exception 'PHASE4_BENEFIT_DRAW_CANCELLED'; end if;
  return public.execute_admin_benefit_draw_unpublished(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_campaign_id,p_idempotency_key,p_now);
end $$;

create function public.publish_admin_benefit_draw(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_campaign_id uuid,p_draw_id uuid,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.benefit_draws%rowtype; w record; inserted boolean:=false;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into d from public.benefit_draws where id=p_draw_id for update;
  if not found then raise exception 'PHASE4_BENEFIT_DRAW_NOT_FOUND'; end if;
  if d.campaign_id<>p_campaign_id then raise exception 'PHASE4_BENEFIT_DRAW_CAMPAIGN_MISMATCH'; end if;
  perform 1 from public.live_benefit_campaigns where id=d.campaign_id for update;
  if exists(select 1 from public.benefit_draw_publications where draw_id=d.id) then return jsonb_build_object('drawId',d.id,'publishedAt',(select published_at from public.benefit_draw_publications where draw_id=d.id),'replayed',true); end if;
  insert into public.benefit_draw_publications(draw_id,campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at) values(d.id,d.campaign_id,p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_now);
  inserted:=true;
  for w in select winner.*,fulfillment.id fulfillment_id,fulfillment.status fulfillment_status,fulfillment.revision fulfillment_revision from public.benefit_draw_winners winner join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id where winner.draw_id=d.id loop
    perform public.insert_action_required_notification(w.app_user_id,'benefit_won','benefit_won:'||w.id::text||':1',null,w.benefit_id,'/benefits/'||w.benefit_id::text,jsonb_build_object('title','Benefit 당첨','detail','당첨된 Benefit을 확인해 주세요.'),p_now);
    insert into public.fan_notifications(app_user_id,kind,source_key,benefit_id,scheduled_for) values(w.app_user_id,'benefit_available','benefit-draw:'||d.id::text||':'||w.benefit_id::text,w.benefit_id,p_now) on conflict(app_user_id,source_key) do nothing;
    if w.fulfillment_status='information_required' then perform public.insert_action_required_notification(w.app_user_id,'recipient_information_required','recipient_information_required:'||w.id::text||':'||w.fulfillment_revision::text,null,w.benefit_id,'/benefits/'||w.benefit_id::text,jsonb_build_object('title','수령 정보 필요','detail','Benefit 수령 정보를 입력해 주세요.','fulfillmentStatus',w.fulfillment_status::text),p_now); end if;
  end loop;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_draw.published','benefit_draw',d.id::text,p_correlation_id,jsonb_build_object('campaignId',d.campaign_id));
  return jsonb_build_object('drawId',d.id,'publishedAt',p_now,'replayed',not inserted);
end $$;

-- Public/owner reward reads are publication gated. Admin campaign review remains internal.
create or replace function public.get_owned_benefit_rewards(p_app_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rewardResultId',dc.id,'winnerId',w.id,'benefitId',dc.benefit_id,'title',coalesce(ko.title,en.title,b.slug),'campaignId',dc.campaign_id,'result',dc.result,'method',case when w.id is null then null else f.method end,'status',case when w.id is null then 'not_selected' else f.status::text end,'enteredTickets',coalesce(entries.total,0),'recipientRequired',coalesce(w.id is not null and f.method in ('physical_shipping','on_site_pickup') and f.status='information_required',false),'updatedAt',case when w.id is null then dc.created_at else f.updated_at end,'benefitHref','/benefits/'||dc.benefit_id::text) order by (case when w.id is null then dc.created_at else f.updated_at end) desc,dc.id desc),'[]'::jsonb)
  from public.benefit_draw_candidates dc join public.benefit_draw_publications publication on publication.draw_id=dc.draw_id join public.benefits b on b.id=dc.benefit_id left join public.benefit_localizations ko on ko.benefit_id=b.id and ko.locale='ko' left join public.benefit_localizations en on en.benefit_id=b.id and en.locale='en' left join public.benefit_draw_winners w on w.candidate_id=dc.id left join public.benefit_fulfillments f on f.winner_id=w.id left join lateral(select sum(e.ticket_amount)::integer total from public.benefit_ticket_entries e where e.campaign_id=dc.campaign_id and e.benefit_id=dc.benefit_id and e.app_user_id=dc.app_user_id) entries on true where dc.app_user_id=p_app_user_id;
$$;

-- Gate existing command functions without exposing their previous implementations.
alter function public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text) rename to save_owned_benefit_recipient_published;
create function public.save_owned_benefit_recipient(p_app_user_id uuid,p_winner_id uuid,p_correlation_id uuid,p_consent_version text,p_consented boolean,p_name text,p_phone text,p_postal_code text default null,p_address1 text default null,p_address2 text default null) returns jsonb language plpgsql security definer set search_path='' as $$ begin if not exists(select 1 from public.benefit_draw_winners w join public.benefit_draw_publications p on p.draw_id=w.draw_id where w.id=p_winner_id) then raise exception 'PHASE4_REWARD_NOT_PUBLISHED'; end if; return public.save_owned_benefit_recipient_published(p_app_user_id,p_winner_id,p_correlation_id,p_consent_version,p_consented,p_name,p_phone,p_postal_code,p_address1,p_address2); end $$;
alter function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean) rename to get_admin_benefit_winner_published;
create function public.get_admin_benefit_winner(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_winner_id uuid,p_reveal boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$ begin if not exists(select 1 from public.benefit_draw_winners w join public.benefit_draw_publications p on p.draw_id=w.draw_id where w.id=p_winner_id) then raise exception 'PHASE4_REWARD_NOT_PUBLISHED'; end if; return public.get_admin_benefit_winner_published(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_winner_id,p_reveal); end $$;
alter function public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) rename to transition_admin_benefit_fulfillment_published;
create function public.transition_admin_benefit_fulfillment(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_winner_id uuid,p_expected_revision integer,p_to_status public.benefit_fulfillment_status,p_carrier text default null,p_tracking_number text default null,p_operator_memo text default null) returns jsonb language plpgsql security definer set search_path='' as $$ begin if not exists(select 1 from public.benefit_draw_winners w join public.benefit_draw_publications p on p.draw_id=w.draw_id where w.id=p_winner_id) then raise exception 'PHASE4_REWARD_NOT_PUBLISHED'; end if; return public.transition_admin_benefit_fulfillment_published(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_winner_id,p_expected_revision,p_to_status,p_carrier,p_tracking_number,p_operator_memo); end $$;

revoke all on function public.get_public_raffles(text,public.content_locale,timestamptz),public.get_admin_benefit_campaigns(uuid,uuid),public.save_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean),public.get_owned_benefit_entry_state(uuid,uuid),public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz),public.cancel_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,text,timestamptz),public.execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz),public.publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz),public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text),public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean),public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text),public.phase5_notify_benefit_winner(),public.phase5_notify_fulfillment_created(),public.phase5_notify_fulfillment_update(),public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz),public.post_benefit_entry_refund(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.execute_admin_benefit_draw_unpublished(uuid,uuid,uuid,uuid,uuid,timestamptz),public.save_owned_benefit_recipient_published(uuid,uuid,uuid,text,boolean,text,text,text,text,text),public.get_admin_benefit_winner_published(uuid,uuid,uuid,uuid,boolean),public.transition_admin_benefit_fulfillment_published(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text),public.suppress_unpublished_benefit_draw_notification(),public.get_admin_benefit_campaigns_base(uuid,uuid),public.get_owned_benefit_entry_state_base(uuid,uuid),public.email_notification_delivery_is_eligible_base(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_public_raffles(text,public.content_locale,timestamptz),public.get_admin_benefit_campaigns(uuid,uuid),public.save_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean),public.get_owned_benefit_entry_state(uuid,uuid),public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz),public.cancel_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,text,timestamptz),public.publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz),public.execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz),public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text),public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean),public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text),public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz) to service_role;
