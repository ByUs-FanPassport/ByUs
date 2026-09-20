-- User-approved extension for Elina's three Banksy LIVE prizes only.
-- Published campaigns are immutable in the general-purpose editor.
do $$
declare
  campaign public.live_benefit_campaigns%rowtype;
  expected_benefits uuid[] := array[
    '81fc87bf-5264-43dd-ba08-95cf2ffc949b',
    'a2cd7407-282f-42a9-b562-aee70a271de4',
    'fff318a6-24c7-4012-8290-3494a55e287c'
  ]::uuid[];
  previous_deadline timestamptz := '2026-09-28T00:00:00+09:00';
  deadline timestamptz := '2026-10-07T18:00:00+09:00';
begin
  select c.* into campaign from public.live_benefit_campaigns c
  join public.live_events l on l.id=c.live_event_id
  join public.celebrities creator on creator.id=l.celebrity_id
  where c.id='14d6ae96-a168-494a-be85-f02f8050fbfa'
    and l.slug='elina-banksy-instagram-20260918' and creator.slug='elina'
  for update of c;
  -- Fresh databases have no production campaign to extend.
  if not found then return; end if;
  if campaign.status<>'published' or campaign.cancelled_at is not null
    or exists(select 1 from public.benefit_draws where campaign_id=campaign.id) then
    raise exception 'Elina campaign must be published, active and not drawn';
  end if;
  if (select array_agg(benefit_id order by benefit_id) from public.live_benefit_campaign_items
      where campaign_id=campaign.id) is distinct from expected_benefits then
    raise exception 'Elina campaign prize set changed';
  end if;
  perform 1 from public.benefits where id=any(expected_benefits) order by id for update;
  if campaign.entry_closes_at not in (previous_deadline,deadline)
    or exists(select 1 from public.benefits where id=any(expected_benefits)
      and (claim_closes_at is null or claim_closes_at not in (previous_deadline,deadline)
        or publication_status<>'published' or archived_at is not null)) then
    raise exception 'Elina deadline or prize state changed';
  end if;
  if campaign.entry_closes_at=deadline and not exists(
    select 1 from public.benefits where id=any(expected_benefits) and claim_closes_at<>deadline
  ) then return; end if;

  update public.live_benefit_campaigns
    set entry_closes_at=deadline,revision=revision+1
    where id=campaign.id and entry_closes_at<>deadline;
  update public.benefits set claim_closes_at=deadline,revision=revision+1
    where id=any(expected_benefits) and claim_closes_at<>deadline;
  insert into public.audit_logs(action,entity_type,entity_id,before_after_summary)
  values('benefit_campaign.deadline_extended','live_benefit_campaign',campaign.id::text,
    jsonb_build_object('source','migration:20260920163432','reason','User requested October 7, 2026 at 18:00 KST',
      'beforeEntryClosesAt',campaign.entry_closes_at,'afterEntryClosesAt',deadline,'benefitIds',to_jsonb(expected_benefits)));
end $$;
