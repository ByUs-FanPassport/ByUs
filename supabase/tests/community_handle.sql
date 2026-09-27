begin;
do $$
declare constraint_name text;
begin
  begin
    insert into public.celebrities(slug, image_url, roles)
    values ('community', '/images/test.jpg', array['creator']::public.celebrity_role[]);
    raise exception 'Community handle was accepted';
  exception when check_violation then
    get stacked diagnostics constraint_name = constraint_name;
    if constraint_name <> 'celebrities_slug_not_reserved' then
      raise exception 'Wrong constraint rejected community: %', constraint_name;
    end if;
  end;
end $$;
rollback;
