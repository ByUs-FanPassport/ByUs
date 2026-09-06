-- Deploy CHZZK-compatible web/CMS code before applying this data migration.
-- Verified source: this CHZZK channel links to instagram.com/jen2jen2_/.
begin;
do $$
declare
  creator_id uuid;
begin
  select id into strict creator_id from public.celebrities where slug = 'jenny-jeong';
  insert into public.celebrity_social_links (celebrity_id, platform, url, position, active)
  select creator_id, 'chzzk',
    'https://chzzk.naver.com/0a3f97086cb81d3360c69fdf5d020045',
    coalesce(max(position), -1) + 1, true
  from public.celebrity_social_links where celebrity_id = creator_id
  on conflict (celebrity_id, platform) do update
    set url = excluded.url, active = true;
end $$;
commit;
