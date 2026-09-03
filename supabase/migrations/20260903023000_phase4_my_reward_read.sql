-- Owner-only Phase 4 Reward history derived from operational draw tables.

create function public.get_owned_benefit_rewards(p_app_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rewardResultId',dc.id,
    'winnerId',w.id,
    'benefitId',dc.benefit_id,
    'title',coalesce(ko.title,en.title,b.slug),
    'campaignId',dc.campaign_id,
    'result',dc.result,
    'method',case when w.id is null then null else f.method end,
    'status',case when w.id is null then 'not_selected' else f.status::text end,
    'enteredTickets',coalesce(entries.total,0),
    'recipientRequired',coalesce(
      w.id is not null and f.method in ('physical_shipping','on_site_pickup')
        and f.status='information_required',false
    ),
    'updatedAt',case when w.id is null then dc.created_at else f.updated_at end,
    'benefitHref','/benefits/'||dc.benefit_id::text
  ) order by
    (case when w.id is null then dc.created_at else f.updated_at end) desc,
    dc.id desc),'[]'::jsonb)
  from public.benefit_draw_candidates dc
  join public.benefits b on b.id=dc.benefit_id
  left join public.benefit_localizations ko on ko.benefit_id=b.id and ko.locale='ko'
  left join public.benefit_localizations en on en.benefit_id=b.id and en.locale='en'
  left join public.benefit_draw_winners w on w.candidate_id=dc.id
  left join public.benefit_fulfillments f on f.winner_id=w.id
  left join lateral (
    select sum(e.ticket_amount)::integer as total
    from public.benefit_ticket_entries e
    where e.campaign_id=dc.campaign_id and e.benefit_id=dc.benefit_id
      and e.app_user_id=dc.app_user_id
  ) entries on true
  where dc.app_user_id=p_app_user_id;
$$;

revoke all on function public.get_owned_benefit_rewards(uuid) from public,anon,authenticated;
grant execute on function public.get_owned_benefit_rewards(uuid) to service_role;
