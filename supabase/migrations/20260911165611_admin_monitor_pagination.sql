drop function if exists public.get_admin_blockchain_jobs(
  uuid, uuid, uuid, public.blockchain_job_status, integer, timestamptz
);

create function public.get_admin_blockchain_jobs(
  target_actor_app_user_id uuid,
  target_actor_admin_allowlist_id uuid,
  target_job_id uuid default null,
  target_status public.blockchain_job_status default null,
  target_limit integer default 50,
  target_before_created_at timestamptz default null,
  target_before_id uuid default null
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  status public.blockchain_job_status,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  transaction_reference text,
  chain_state text,
  safe_error_code text,
  safe_error_summary text,
  manually_retryable boolean,
  attempt_history jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_blockchain_job_admin_actor(
    target_actor_app_user_id, target_actor_admin_allowlist_id, false
  );
  if target_limit < 1 or target_limit > 101 then
    raise exception 'limit must be between 1 and 101';
  end if;
  if target_before_id is not null and target_before_created_at is null then
    raise exception 'cursor timestamp is required with cursor id';
  end if;

  return query
  select
    job.id,
    job.entity_type,
    job.entity_id,
    job.status,
    job.attempts,
    job.max_attempts,
    job.next_attempt_at,
    job.created_at,
    job.updated_at,
    job.completed_at,
    case when job.tx_hash is null then null
      else left(job.tx_hash, 10) || '…' || right(job.tx_hash, 8)
    end,
    case
      when job.status = 'COMPLETED' then 'confirmed'
      when job.tx_hash is not null then 'prepared_reconciliation_required'
      else 'not_submitted'
    end,
    public.redact_blockchain_job_error_code(job.last_error_code),
    case
      when job.last_error_code is null then null
      when job.last_error_code = 'LEASE_EXPIRED' then 'Worker lease expired before completion.'
      when job.last_error_code like 'GIWA_%' then 'Chain provider operation requires review.'
      when job.last_error_code like 'PINATA_%' then 'Metadata storage operation requires review.'
      when job.last_error_code in ('MISSING_SIGNED_TRANSACTION', 'MINT_EVENT_NOT_FOUND') then 'Chain reconciliation requires review.'
      else 'Job processing failed. Review the machine error code.'
    end,
    job.status in ('RETRYING', 'FAILED') and job.attempts < 32,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'attemptNumber', history.attempt_number,
        'event', history.event,
        'fromStatus', history.from_status,
        'toStatus', history.to_status,
        'errorCode', history.safe_error_code,
        'createdAt', history.created_at,
        'correlationId', history.correlation_id
      ) order by history.created_at, history.id)
      from public.blockchain_job_attempt_history history
      where history.blockchain_job_id = job.id
    ), '[]'::jsonb)
  from public.blockchain_jobs job
  where (target_job_id is null or job.id = target_job_id)
    and (target_status is null or job.status = target_status)
    and (
      target_before_created_at is null
      or (target_before_id is null and job.created_at < target_before_created_at)
      or (target_before_id is not null and (job.created_at, job.id) < (target_before_created_at, target_before_id))
    )
  order by job.created_at desc, job.id desc
  limit target_limit;
end;
$$;

revoke all on function public.get_admin_blockchain_jobs(
  uuid, uuid, uuid, public.blockchain_job_status, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.get_admin_blockchain_jobs(
  uuid, uuid, uuid, public.blockchain_job_status, integer, timestamptz, uuid
) to service_role;

drop function if exists public.get_admin_notification_deliveries(
  uuid, uuid, public.notification_delivery_status, integer
);

create function public.get_admin_notification_deliveries(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_status public.notification_delivery_status default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_blockchain_job_admin_actor(
    p_actor_app_user_id, p_actor_admin_allowlist_id, false
  );
  if p_limit < 1 or p_limit > 101 then
    raise exception 'limit must be between 1 and 101';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor timestamp and id must be supplied together';
  end if;

  return jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'processing', count(*) filter (where status = 'processing'),
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status = 'failed')
      )
      from (
        select status from public.notification_delivery_outbox
        union all
        select status from public.external_notification_delivery_outbox
      ) counted
    ),
    'items', coalesce((
      with combined as (
        select
          push.id,
          'push'::text as channel,
          notification.kind::text as kind,
          push.status::text as status,
          push.attempt_count as "attemptCount",
          case when push.available_at = 'infinity'::timestamptz
            then '9999-12-31T23:59:59Z'::timestamptz else push.available_at end as "nextAttemptAt",
          'Web Push ••••' || right(subscription.endpoint_hash, 4) as "destinationLabel",
          push.last_error_code as "errorCode",
          push.created_at as "createdAt",
          push.sent_at as "sentAt",
          (push.status = 'failed' and push.available_at = 'infinity'::timestamptz and retry.id is null) as "manuallyRetryable",
          null::text as "providerStatus",
          null::text as "providerMessageId",
          null::text as "providerStatusCode"
        from public.notification_delivery_outbox push
        join public.fan_notifications notification on notification.id = push.notification_id
        join public.push_subscriptions subscription on subscription.id = push.subscription_id
        left join public.notification_delivery_manual_retries retry on retry.delivery_type = 'push' and retry.delivery_id = push.id
        where p_status is null or push.status = p_status
        union all
        select
          external.id,
          external.channel,
          notification.kind::text,
          external.status::text,
          external.attempt_count,
          case when external.available_at = 'infinity'::timestamptz
            then '9999-12-31T23:59:59Z'::timestamptz else external.available_at end,
          channel.destination_label,
          external.last_error_code,
          external.created_at,
          external.sent_at,
          (external.channel <> 'kakao' and external.status = 'failed' and external.available_at = 'infinity'::timestamptz and retry.id is null),
          attempt.status,
          attempt.provider_message_id,
          attempt.provider_status_code
        from public.external_notification_delivery_outbox external
        join public.fan_notifications notification on notification.id = external.notification_id
        join public.fan_notification_channels channel on channel.id = external.channel_id
        left join public.notification_delivery_manual_retries retry on retry.delivery_type = 'external' and retry.delivery_id = external.id
        left join public.kakao_notification_attempts attempt on attempt.delivery_id = external.id
        where p_status is null or external.status = p_status
      )
      select jsonb_agg(pg_catalog.to_jsonb(item) order by item."createdAt" desc, item.id desc)
      from (
        select *
        from combined
        where p_cursor_created_at is null
          or (combined."createdAt", combined.id) < (p_cursor_created_at, p_cursor_id)
        order by combined."createdAt" desc, combined.id desc
        limit p_limit
      ) item
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_notification_deliveries(
  uuid, uuid, public.notification_delivery_status, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.get_admin_notification_deliveries(
  uuid, uuid, public.notification_delivery_status, integer, timestamptz, uuid
) to service_role;
