begin;

do $$
declare
  draft_id uuid := '97100000-0000-4000-8000-000000000001';
  published_id uuid := '97100000-0000-4000-8000-000000000002';
  original_count bigint;
  duplicate_rejected boolean := false;
  reserved_rejected boolean := false;
  rename_rejected boolean := false;
  first_publication timestamptz;
begin
  select count(*) into original_count from public.celebrities;

  insert into public.celebrities(id, slug, image_url, primary_role, roles)
  values (draft_id, 'handle-draft', '/handle-draft.jpg', 'creator', array['creator']::public.celebrity_role[]);
  update public.celebrities set slug = 'handle-renamed' where id = draft_id;
  if (select slug from public.celebrities where id = draft_id) <> 'handle-renamed' then
    raise exception 'never-published draft rename failed';
  end if;

  begin
    insert into public.celebrities(slug, image_url, primary_role, roles)
    values ('handle-renamed', '/duplicate.jpg', 'creator', array['creator']::public.celebrity_role[]);
  exception when unique_violation then duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'duplicate handle was accepted'; end if;

  begin
    insert into public.celebrities(slug, image_url, primary_role, roles)
    values ('admin', '/reserved.jpg', 'creator', array['creator']::public.celebrity_role[]);
  exception when check_violation then reserved_rejected := true;
  end;
  if not reserved_rejected then raise exception 'reserved handle was accepted'; end if;

  insert into public.celebrities(id, slug, image_url, fan_count, primary_role, roles)
  values (published_id, 'published-handle', '/published.jpg', 1, 'creator', array['creator']::public.celebrity_role[]);
  update public.celebrities set status = 'published' where id = published_id;
  select ever_published_at into first_publication from public.celebrities where id = published_id;
  if first_publication is null then raise exception 'first publication history was not recorded'; end if;

  update public.celebrities set status = 'draft' where id = published_id;
  if (select published_at from public.celebrities where id = published_id) is not null
     or (select ever_published_at from public.celebrities where id = published_id) is distinct from first_publication then
    raise exception 'unpublish did not preserve first publication history';
  end if;

  begin
    update public.celebrities set slug = 'renamed-after-unpublish' where id = published_id;
  exception when check_violation then rename_rejected := true;
  end;
  if not rename_rejected then raise exception 'published handle changed after unpublish'; end if;

  update public.celebrities set slug = 'published-handle' where id = published_id;
  if (select slug from public.celebrities where id = published_id) <> 'published-handle' then
    raise exception 'same-handle edit changed stored identity';
  end if;

  if (select count(*) from public.celebrities) <> original_count + 2 then
    raise exception 'rejected writes changed celebrity records';
  end if;
end $$;

select 'celebrity public handle policy PASS';
rollback;
