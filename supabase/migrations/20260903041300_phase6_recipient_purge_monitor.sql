-- Independent recipient-purge health projection for Admin operations.
create function public.read_admin_recipient_purge_status(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_as_of timestamptz default pg_catalog.now()
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare latest public.benefit_maintenance_runs%rowtype;last_success timestamptz;state text;
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select * into latest from public.benefit_maintenance_runs where maintenance_type='recipient_purge' order by finished_at desc,id desc limit 1;
  select max(finished_at) into last_success from public.benefit_maintenance_runs where maintenance_type='recipient_purge' and succeeded;
  state:=case when latest.id is null then 'never_run' when latest.last_error_code is not null then 'error' when latest.finished_at<p_as_of-interval '26 hours' then 'overdue' else 'healthy' end;
  return jsonb_build_object(
    'state',state,'cadenceHours',24,'lastRunAt',latest.finished_at,
    'lastSuccessAt',last_success,'lastErrorCode',latest.last_error_code,
    'deletedCount',latest.deleted_count,'source','benefit_maintenance_runs(recipient_purge)'
  );
end$$;
revoke all on function public.read_admin_recipient_purge_status(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.read_admin_recipient_purge_status(uuid,uuid,timestamptz) to service_role;
