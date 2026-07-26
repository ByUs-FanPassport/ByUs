-- Set the operator-managed KATSEYE fan count used by public discovery and LIVE surfaces.

do $$
declare
  updated_count integer;
begin
  update public.celebrities
  set fan_count = 6800000
  where id = 'ca75e1e0-0000-4000-8000-000000000001'
    and slug = 'katseye';

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'KATSEYE celebrity row is missing or ambiguous';
  end if;
end $$;
