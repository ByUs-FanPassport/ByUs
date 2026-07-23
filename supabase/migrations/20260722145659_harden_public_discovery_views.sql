-- Public discovery is served by the application server. Keep the DTO views
-- invoker-safe and accessible only to the server-side service role so browser
-- roles cannot use a view owner to bypass source-table RLS.

alter view public.published_celebrities
  set (security_invoker = true);

alter view public.published_celebrity_live_summaries
  set (security_invoker = true);

revoke all on public.published_celebrities
  from public, anon, authenticated;
revoke all on public.published_celebrity_live_summaries
  from public, anon, authenticated;

grant select on public.published_celebrities to service_role;
grant select on public.published_celebrity_live_summaries to service_role;
