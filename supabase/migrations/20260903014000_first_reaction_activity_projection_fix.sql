-- First Reaction is a non-score history item with its own projection. Keep it
-- out of the legacy score-bearing Stamp activity array.
create or replace function public.get_owned_passport_detail(
  p_passport_id uuid,
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    (base - 'activities')
    || jsonb_build_object(
      'activities',
      coalesce((
        select jsonb_agg(activity.value order by activity.ordinality)
        from jsonb_array_elements(
          coalesce(base -> 'activities', '[]'::jsonb)
        ) with ordinality as activity(value, ordinality)
        where activity.value ->> 'type' <> 'first_reaction'
      ), '[]'::jsonb)
    )
    || jsonb_build_object('firstReaction', (
      select jsonb_build_object(
        'reactionId', stamp.reaction_id,
        'stampId', stamp.id,
        'activityId', stamp.activity_id,
        'reactionType', 'FirstReaction',
        'mintStatus', stamp.mint_status,
        'txHash', stamp.tx_hash,
        'issuedAt', stamp.issued_at
      )
      from public.first_reaction_stamps stamp
      join public.fan_reactions reaction on reaction.id = stamp.reaction_id
      where stamp.passport_id = p_passport_id
        and stamp.app_user_id = p_app_user_id
    ))
  from public.get_owned_passport_detail_before_first_reaction(
    p_passport_id,
    p_app_user_id,
    p_locale
  ) base;
$$;

revoke all on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) from public, anon, authenticated;
grant execute on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) to service_role;

comment on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) is 'Returns score-bearing Passport activities separately from the one-time First Reaction history item.';
