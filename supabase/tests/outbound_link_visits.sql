begin;

do $$
declare
  client_role text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.outbound_link_visits'::regclass) then
    raise exception 'Outbound visit RLS must be enabled';
  end if;
  foreach client_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(client_role, 'public.outbound_link_visits', 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'Client role % must not access visit records', client_role;
    end if;
  end loop;
end $$;

set local role service_role;
insert into public.outbound_link_visits (campaign, created_at) values
  ('elina-banksy-instagram', '2026-09-20T14:59:59Z'),
  ('elina-banksy-instagram', '2026-09-20T15:00:00Z'),
  ('elina-banksy-instagram', '2026-09-20T15:00:00Z');

do $$
begin
  if (select count(*) from public.outbound_link_visits where campaign = 'elina-banksy-instagram') <> 3 then
    raise exception 'Repeat requests must be counted independently';
  end if;
  if (select count(*) from public.outbound_link_visits
      where campaign = 'elina-banksy-instagram'
      and (created_at at time zone 'Asia/Seoul')::date = date '2026-09-21') <> 2 then
    raise exception 'Daily counts must use KST';
  end if;
  begin
    insert into public.outbound_link_visits (campaign) values ('invalid campaign');
    raise exception 'Malformed campaign accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
