\ir bias_celebrity_public_handle.sql
\ir ../rollback/20260913133000_bias_celebrity_public_handle.sql

begin;

do $$
declare
  admin_rejected boolean := false;
begin
  insert into public.celebrities(slug, image_url, primary_role, roles)
  values ('bias', '/bias-after-rollback.jpg', 'creator', array['creator']::public.celebrity_role[]);

  begin
    insert into public.celebrities(slug, image_url, primary_role, roles)
    values ('admin', '/admin-after-rollback.jpg', 'creator', array['creator']::public.celebrity_role[]);
  exception when check_violation then
    admin_rejected := true;
  end;

  if not admin_rejected then
    raise exception 'rollback lost the previous reserved handle policy';
  end if;
end $$;

select 'bias celebrity public handle rollback PASS';
rollback;
