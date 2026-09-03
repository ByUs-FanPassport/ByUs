-- Privacy-safe cross-channel delivery monitoring and exact manual retry.
create table public.notification_delivery_manual_retries (
  id uuid primary key default extensions.gen_random_uuid(),
  delivery_type text not null check(delivery_type in ('push','external')),
  delivery_id uuid not null,
  idempotency_key uuid not null,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(delivery_type,delivery_id), unique(idempotency_key)
);
alter table public.notification_delivery_manual_retries enable row level security;
alter table public.notification_delivery_manual_retries force row level security;
revoke all on table public.notification_delivery_manual_retries from public,anon,authenticated,service_role;

create function public.get_admin_notification_deliveries(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_status public.notification_delivery_status default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_limit<1 or p_limit>100 then raise exception 'limit must be between 1 and 100'; end if;
  return jsonb_build_object(
    'counts',(select jsonb_build_object('pending',count(*)filter(where status='pending'),'processing',count(*)filter(where status='processing'),'sent',count(*)filter(where status='sent'),'failed',count(*)filter(where status='failed')) from (
      select status from public.notification_delivery_outbox union all select status from public.external_notification_delivery_outbox
    ) q),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x."createdAt" desc,x.id desc) from (
      select o.id,'push'::text channel,n.kind::text kind,o.status::text status,o.attempt_count "attemptCount",o.available_at "nextAttemptAt",'Web Push ••••'||right(s.endpoint_hash,4) "destinationLabel",o.last_error_code "errorCode",o.created_at "createdAt",o.sent_at "sentAt",(o.status='failed' and o.available_at='infinity'::timestamptz and r.id is null) "manuallyRetryable"
      from public.notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id join public.push_subscriptions s on s.id=o.subscription_id left join public.notification_delivery_manual_retries r on r.delivery_type='push' and r.delivery_id=o.id
      where p_status is null or o.status=p_status
      union all
      select o.id,o.channel,n.kind::text,o.status::text,o.attempt_count,o.available_at,c.destination_label,o.last_error_code,o.created_at,o.sent_at,(o.status='failed' and o.available_at='infinity'::timestamptz and r.id is null)
      from public.external_notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id join public.fan_notification_channels c on c.id=o.channel_id left join public.notification_delivery_manual_retries r on r.delivery_type='external' and r.delivery_id=o.id
      where p_status is null or o.status=p_status
      order by "createdAt" desc,id desc limit p_limit
    )x),'[]'::jsonb)
  );
end $$;

create function public.admin_retry_notification_delivery(
  p_delivery_id uuid,p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_idempotency_key uuid,p_correlation_id uuid,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_type text;v_attempts integer;v_existing public.notification_delivery_manual_retries%rowtype;
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into v_existing from public.notification_delivery_manual_retries where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.delivery_id<>p_delivery_id then raise exception 'idempotency key conflict'; end if;
    return jsonb_build_object('id',p_delivery_id,'status','pending','retried',false);
  end if;
  update public.external_notification_delivery_outbox set status='pending',available_at=p_now,last_error_code=null,updated_at=p_now where id=p_delivery_id and status='failed' and available_at='infinity'::timestamptz returning attempt_count into v_attempts;
  if found then v_type:='external'; update public.notification_delivery_plans p set status='pending',updated_at=p_now from public.external_notification_delivery_outbox o where o.id=p_delivery_id and p.id=o.plan_id; else
    update public.notification_delivery_outbox set status='pending',available_at=p_now,last_error_code=null,updated_at=p_now where id=p_delivery_id and status='failed' and available_at='infinity'::timestamptz returning attempt_count into v_attempts;
    if found then v_type:='push'; else raise exception 'delivery is not final failed'; end if;
  end if;
  insert into public.notification_delivery_manual_retries(delivery_type,delivery_id,idempotency_key,actor_app_user_id,actor_admin_allowlist_id,created_at) values(v_type,p_delivery_id,p_idempotency_key,p_actor_app_user_id,p_actor_admin_allowlist_id,p_now);
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id,created_at) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'notification_delivery.retry_requested','notification_delivery',p_delivery_id::text,jsonb_build_object('before',jsonb_build_object('status','failed'),'after',jsonb_build_object('status','pending','channel',v_type,'attemptCount',v_attempts)),p_correlation_id,p_now);
  return jsonb_build_object('id',p_delivery_id,'status','pending','retried',true);
end $$;
revoke all on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer) from public,anon,authenticated;
revoke all on function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer),public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;
