-- Apply the outbound_link_visits migration before deploying/sharing
-- https://byus.kr/go/elina-banksy in Elina's Instagram content.
-- Run with a database administrator or service_role; counts are deliberately not public.
-- Repeat visits count again. Known previews, HEAD and prefetch requests are excluded.
-- This is an Instagram-only campaign: Facebook referrals are excluded, including
-- real Facebook visits. Meta scans impersonate changing desktop Chrome versions
-- (131.0.6780.64 and 119.0.8976.12 observed) with a facebook.com referrer.
-- Release check for this redirect: send a fresh link in an Instagram self-DM,
-- wait for preview/scanning, assert no added visit, then tap and assert +1.
-- Production evidence: 2026-09-20 15:56:29 UTC scan preceded the 15:56:41 tap.
-- The changed scanner UA was observed again at 2026-09-20 16:06:14 UTC.
-- Header filtering is best-effort; storage failures can undercount. This measures
-- redirect requests, not unique people, verified Instagram referrals, arrivals or sales.

select count(*) as total_redirects
from public.outbound_link_visits
where campaign = 'elina-banksy-instagram';

select (created_at at time zone 'Asia/Seoul')::date as date_kst,
       count(*) as redirects
from public.outbound_link_visits
where campaign = 'elina-banksy-instagram'
group by 1
order by 1 desc;
