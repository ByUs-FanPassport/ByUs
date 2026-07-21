-- One owner-scoped snapshot for the FAN-009 issued reward presentation.
create function public.get_owned_passport_issuance(
  p_passport_id uuid,
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  credential_count integer;
begin
  if not exists (
    select 1
    from public.fan_passports p
    where p.id = p_passport_id
      and p.app_user_id = p_app_user_id
  ) then
    return null;
  end if;

  select count(*)
  into credential_count
  from public.fan_passports p
  join public.stamps s
    on s.passport_id = p.id
   and s.app_user_id = p.app_user_id
   and s.celebrity_id = p.celebrity_id
   and s.stamp_type = 'knowledge'
  join public.fan_activities a
    on a.id = s.activity_id
   and a.app_user_id = s.app_user_id
   and a.celebrity_id = s.celebrity_id
   and a.activity_type = 'knowledge'
   and a.source_type = 'quiz_pass'
   and a.source_id = p.quiz_pass_id
  join public.fan_score_ledger score
    on score.activity_id = a.id
   and score.app_user_id = a.app_user_id
   and score.celebrity_id = a.celebrity_id
  where p.id = p_passport_id
    and p.app_user_id = p_app_user_id;

  if credential_count <> 1 then
    raise exception 'issued reward aggregate is inconsistent';
  end if;

  select jsonb_build_object(
    'passport', jsonb_build_object(
      'id', p.id,
      'businessStatus', p.business_status,
      'mintStatus', p.mint_status,
      'tokenId', p.token_id::text,
      'issuedAt', p.issued_at
    ),
    'celebrity', jsonb_build_object(
      'slug', c.slug,
      'name', localization.name,
      'image', jsonb_build_object(
        'url', c.image_url,
        'alt', localization.image_alt,
        'position', c.image_position
      )
    ),
    'firstStamp', jsonb_build_object(
      'type', s.stamp_type,
      'businessStatus', s.business_status,
      'mintStatus', s.mint_status,
      'tokenId', s.token_id::text,
      'issuedAt', s.issued_at
    ),
    'score', jsonb_build_object('points', score.points)
  )
  into result
  from public.fan_passports p
  join public.celebrities c on c.id = p.celebrity_id
  join public.celebrity_localizations localization
    on localization.celebrity_id = c.id
   and localization.locale = p_locale
  join public.stamps s
    on s.passport_id = p.id
   and s.app_user_id = p.app_user_id
   and s.celebrity_id = p.celebrity_id
   and s.stamp_type = 'knowledge'
  join public.fan_activities a
    on a.id = s.activity_id
   and a.app_user_id = s.app_user_id
   and a.celebrity_id = s.celebrity_id
   and a.activity_type = 'knowledge'
   and a.source_type = 'quiz_pass'
   and a.source_id = p.quiz_pass_id
  join public.fan_score_ledger score
    on score.activity_id = a.id
   and score.app_user_id = a.app_user_id
   and score.celebrity_id = a.celebrity_id
  where p.id = p_passport_id
    and p.app_user_id = p_app_user_id
  order by s.issued_at, s.id
  limit 1;

  if result is null then
    raise exception 'issued reward display projection is incomplete';
  end if;
  return result;
end;
$$;

revoke all on function public.get_owned_passport_issuance(uuid, uuid, public.content_locale) from public, anon, authenticated;
grant execute on function public.get_owned_passport_issuance(uuid, uuid, public.content_locale) to service_role;
