-- The one-minute mint cron previously rechecked every historical receipt.
-- ponytail: each nonfinalized receipt is checked once per hour; shorten the
-- bucket interval only if reorg detection needs to be faster.
begin;
create or replace function public.list_fan_action_receipts(p_limit integer default 100,p_after_job_id uuid default null)
returns table(job_id uuid,payload jsonb,receipt jsonb,inclusion_status text)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 1000 then raise exception 'FAN_ACTION_INVALID_LIMIT'; end if;
  return query select q.id,q.payload,r.receipt,r.inclusion_status
    from public.fan_action_chain_receipts r join public.fan_action_outbox q on q.id=r.outbox_id
    where r.inclusion_status<>'finalized'
      and mod(abs(pg_catalog.hashtext(q.id::text)::bigint),60)=extract(minute from pg_catalog.now())::integer
      and (p_after_job_id is null or q.id>p_after_job_id)
    order by q.id limit p_limit;
end $$;

do $$
begin
  if exists(select 1 from public.celebrities where slug='go') then
    raise exception 'reserved celebrity handle conflicts: go' using errcode='23514';
  end if;
end $$;
alter table public.celebrities drop constraint celebrities_slug_not_reserved;
alter table public.celebrities add constraint celebrities_slug_not_reserved check (slug <> all (array[
  'admin','api','benefits','bias','c','celebrities','connect','creator','go','guide',
  'live','login','my','notifications','o','onboarding','pages','passports',
  'privacy','s','settings','stamps','t','terms','fonts','images','share','_next',
  '.well-known'
]::text[]));

-- The published raffle now closes October 7, but the stored prize copy kept September 27.
update public.benefit_localizations
set summary=case locale
  when 'ko' then '엘리나 응모권으로 10월 7일 오후 6시까지 응모하세요.'
  when 'en' then 'Enter with ELINA tickets until October 7 at 6 p.m. (KST).'
end
where benefit_id='fff318a6-24c7-4012-8290-3494a55e287c'
  and ((locale='ko' and summary='엘리나 응모권으로 9월 27일 밤 12시까지 응모하세요.')
    or (locale='en' and summary='Enter with ELINA tickets until September 27 at midnight (KST).'))
  and exists(select 1 from public.live_benefit_campaign_items i
    join public.live_benefit_campaigns c on c.id=i.campaign_id
    where i.benefit_id=benefit_localizations.benefit_id
      and c.id='14d6ae96-a168-494a-be85-f02f8050fbfa'
      and c.entry_closes_at='2026-10-07T18:00:00+09:00');

commit;
