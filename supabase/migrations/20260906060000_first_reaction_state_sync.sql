-- Keep the First Reaction projection aligned with its canonical Reaction mint
-- result. The projection owns display metadata and Passport attachment only;
-- blockchain status and result fields always come from fan_reactions.

do $$
begin
  if exists (
    select 1
    from public.first_reaction_stamps stamp
    join public.fan_reactions reaction
      on reaction.id = stamp.reaction_id
     and reaction.id = stamp.blockchain_source_id
     and reaction.app_user_id = stamp.app_user_id
     and reaction.celebrity_id = stamp.celebrity_id
    where stamp.mint_status = 'minted'
      and (stamp.mint_status, stamp.tx_hash, stamp.token_id)
        is distinct from
          (reaction.mint_status, reaction.tx_hash, reaction.token_id)
  ) then
    raise exception 'FIRST_REACTION_MINTED_DERIVED_CONFLICT'
      using errcode = '23514';
  end if;
end;
$$;

create function public.sync_first_reaction_stamp_mint_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.mint_status, new.tx_hash, new.token_id)
    is not distinct from (old.mint_status, old.tx_hash, old.token_id) then
    return new;
  end if;

  update public.first_reaction_stamps stamp
  set mint_status = new.mint_status,
      tx_hash = new.tx_hash,
      token_id = new.token_id
  where stamp.reaction_id = new.id
    and stamp.blockchain_source_id = new.id
    and stamp.app_user_id = new.app_user_id
    and stamp.celebrity_id = new.celebrity_id
    and (stamp.mint_status, stamp.tx_hash, stamp.token_id)
      is distinct from (new.mint_status, new.tx_hash, new.token_id);

  return new;
end;
$$;

create trigger fan_reactions_sync_first_reaction_stamp_mint_result
after update of mint_status, tx_hash, token_id on public.fan_reactions
for each row
execute function public.sync_first_reaction_stamp_mint_result();

update public.first_reaction_stamps stamp
set mint_status = reaction.mint_status,
    tx_hash = reaction.tx_hash,
    token_id = reaction.token_id
from public.fan_reactions reaction
where reaction.id = stamp.reaction_id
  and reaction.id = stamp.blockchain_source_id
  and reaction.app_user_id = stamp.app_user_id
  and reaction.celebrity_id = stamp.celebrity_id
  and (stamp.mint_status, stamp.tx_hash, stamp.token_id)
    is distinct from
      (reaction.mint_status, reaction.tx_hash, reaction.token_id);

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
        'mintStatus', reaction.mint_status,
        'txHash', reaction.tx_hash,
        'issuedAt', stamp.issued_at
      )
      from public.first_reaction_stamps stamp
      join public.fan_reactions reaction
        on reaction.id = stamp.reaction_id
       and reaction.id = stamp.blockchain_source_id
       and reaction.app_user_id = stamp.app_user_id
       and reaction.celebrity_id = stamp.celebrity_id
      where stamp.passport_id = p_passport_id
        and stamp.app_user_id = p_app_user_id
        and reaction.app_user_id = p_app_user_id
    ))
  from public.get_owned_passport_detail_before_first_reaction(
    p_passport_id,
    p_app_user_id,
    p_locale
  ) base;
$$;

revoke all on function public.sync_first_reaction_stamp_mint_result()
  from public, anon, authenticated, service_role;
revoke all on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) from public, anon, authenticated;
grant execute on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) to service_role;

comment on function public.sync_first_reaction_stamp_mint_result() is
  'Synchronizes the derived First Reaction projection after canonical Reaction mint-result changes.';
comment on function public.get_owned_passport_detail(
  uuid, uuid, public.content_locale
) is
  'Returns score-bearing Passport activities separately from First Reaction, whose mint result is read from the canonical Reaction.';
