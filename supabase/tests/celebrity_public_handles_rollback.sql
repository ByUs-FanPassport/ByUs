\ir celebrity_public_handles.sql
\ir ../rollback/20260913070000_celebrity_public_handle_policy.sql

begin;

do $$
declare
  rollback_id uuid := '97100000-0000-4000-8000-000000000003';
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'celebrities_slug_not_reserved'
      and conrelid = 'public.celebrities'::regclass
  ) then
    raise exception 'rollback retained the reserved handle constraint';
  end if;

  insert into public.celebrities(id, slug, image_url, fan_count, primary_role, roles)
  values (rollback_id, 'rollback-handle', '/rollback.jpg', 1, 'creator', array['creator']::public.celebrity_role[]);
  update public.celebrities set status = 'published' where id = rollback_id;
  update public.celebrities set status = 'draft' where id = rollback_id;
  update public.celebrities set slug = 'rollback-renamed' where id = rollback_id;

  if (select slug from public.celebrities where id = rollback_id) <> 'rollback-renamed' then
    raise exception 'rollback did not restore the prior slug policy';
  end if;
end $$;

select 'celebrity public handle rollback PASS';
rollback;
