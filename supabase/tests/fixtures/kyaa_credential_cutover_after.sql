do $$
declare f public.kyaa_upgrade_fixture;
begin
  select * into strict f from public.kyaa_upgrade_fixture;
  if (select to_jsonb(q) from public.fan_action_outbox q where id=f.job) is distinct from f.original then
    raise exception 'KYAA migration changed an existing outbox';
  end if;
  if (select transmission_paused from public.mint_dispatch_policy where singleton) then
    raise exception 'KYAA migration unexpectedly paused dispatch';
  end if;
  update public.fan_action_producer_routes set binding_id=f.new_binding,policy_version=2 where action_code=6;
  if public.enqueue_fan_action_source('cutover_fixture','old',f.owner_id,f.creator,null,f.happened,6,f.descriptor)<>f.job
    or (select to_jsonb(q) from public.fan_action_outbox q where id=f.job) is distinct from f.original then
    raise exception 'KYAA upgrade replay changed original binding or snapshot';
  end if;
end $$;
-- The runner destroys this database after the upgrade assertion.
