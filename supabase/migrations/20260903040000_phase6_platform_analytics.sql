-- Shared Phase 6 analytics contract. Operational facts are authoritative;
-- product events are used only for page views and CTA measurement.
create function public.validate_admin_analytics_window(
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_as_of is null
     or p_from >= p_to
     or p_to > p_as_of
     or p_to - p_from > interval '366 days' then
    raise exception 'analytics time range must be a valid [from,to) interval ending at or before asOf'
      using errcode = '22023';
  end if;
end $$;

-- This reference deliberately centralizes Tier ownership. Analytics must call
-- fan_level_for_score/get_fan_effective_tier_for_score rather than duplicating
-- legacy 0/5/10/20/35 bucket literals.
comment on function public.validate_admin_analytics_window(timestamptz,timestamptz,timestamptz) is
  'Phase 6 [from,to) analytics window validator; Tier projections delegate to fan_level_for_score.';

revoke all on function public.validate_admin_analytics_window(timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;

