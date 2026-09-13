begin;

do $$
declare
  original_count bigint;
  bias_rejected boolean := false;
begin
  select count(*) into original_count from public.celebrities;

  begin
    insert into public.celebrities(slug, image_url, primary_role, roles)
    values ('bias', '/bias-collision.jpg', 'creator', array['creator']::public.celebrity_role[]);
  exception when check_violation then
    bias_rejected := true;
  end;

  if not bias_rejected then
    raise exception 'bias celebrity handle was accepted';
  end if;
  if (select count(*) from public.celebrities) <> original_count then
    raise exception 'bias rejection changed celebrity records';
  end if;
end $$;

select 'bias celebrity public handle policy PASS';
rollback;
