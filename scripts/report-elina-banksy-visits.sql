-- Apply the outbound_link_visits migration before deploying/sharing
-- https://byus.kr/go/elina-banksy in Elina's Instagram content.
-- Run with a database administrator or service_role; counts are deliberately not public.
-- Repeat visits count again. Known previews, HEAD and prefetch requests are excluded.
-- Also excludes the observed Meta link scan (Windows Chrome 131.0.6780.64
-- with https://www.facebook.com/ referrer); an identical real Facebook visit is
-- indistinguishable. Review this signature if Meta changes its scanner.
-- Release check for this redirect: send a fresh link in an Instagram self-DM,
-- wait for preview/scanning, assert no added visit, then tap and assert +1.
-- Production evidence: 2026-09-20 15:56:29 UTC scan preceded the 15:56:41 tap.
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
