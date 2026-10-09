-- Expose announcement timing only; personal outcomes remain in owner-scoped RPCs.
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
    'resultsPublishedAt',(select publication.published_at from public.benefit_draw_publications publication where publication.campaign_id=c.id),
    'fulfillmentMethod',i.fulfillment_method,'perFanTicketLimit',i.per_fan_ticket_limit,
    'requiresFanVerification',c.live_event_id is null,
    'fulfillmentPolicy',public.raffle_fulfillment_policy_json(c.id,i.benefit_id,i.active_fulfillment_policy_version)
  ) order by c.entry_opens_at nulls last,i.priority,c.id),'[]'::jsonb))
  from public.live_benefit_campaigns c
  left join public.live_events e on e.id=c.live_event_id
  join public.celebrities celebrity
    on celebrity.id=coalesce(c.celebrity_id,e.celebrity_id) and celebrity.slug=p_celebrity_slug
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  join public.benefits b on b.id=i.benefit_id
  left join public.benefit_localizations l on l.benefit_id=b.id and l.locale=p_locale
  where celebrity.status='published' and celebrity.archived_at is null and b.archived_at is null
    and (c.live_event_id is null or (e.publication_status='published' and e.archived_at is null))
    and ((c.status='published' and b.publication_status='published')
      or (c.status='draft' and c.public_teaser and b.publication_status='draft'));
$$;
