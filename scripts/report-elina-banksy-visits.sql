-- Apply the outbound_link_visits migration before deploying/sharing
-- https://byus.kr/go/elina-banksy in Elina's Instagram content.
-- Run with a database administrator or service_role; counts are deliberately not public.
-- Repeat visits count again. Known previews, HEAD and prefetch requests are excluded.
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
