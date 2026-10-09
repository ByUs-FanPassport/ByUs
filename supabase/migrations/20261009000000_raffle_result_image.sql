-- Include the existing prize image in both owned result projections.
create or replace function public.build_owned_raffle_result(
  p_app_user_id uuid,p_campaign_id uuid,p_benefit_id uuid,p_locale public.content_locale
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb; v_title text; v_method public.benefit_fulfillment_method;
  v_entry_closes_at timestamptz; v_cancelled boolean; v_entered integer;
  v_publication timestamptz; v_winner uuid; v_fulfillment public.benefit_fulfillments%rowtype;
  v_state text; v_policy_version text; v_recipient_submitted boolean:=false;
  v_carrier text; v_tracking_number text; v_image_url text;
begin
  select case when p_locale='ko' then coalesce(ko.title,en.title,b.slug)
      else coalesce(en.title,ko.title,b.slug) end,
    item.fulfillment_method,c.entry_closes_at,c.cancelled_at is not null,
    item.active_fulfillment_policy_version,item.teaser_image_url
  into v_title,v_method,v_entry_closes_at,v_cancelled,v_policy_version,v_image_url
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
    'imageUrl',v_image_url,
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
