-- Correct the already-deployed registration function so PL/pgSQL variables can
-- never collide with notification_delivery_outbox column names. This definition
-- is intentionally identical to the fresh-schema definition in G7.
create or replace function public.register_push_subscription(
  p_app_user_id uuid,p_endpoint text,p_endpoint_hash text,p_p256dh text,p_auth_secret text,p_user_agent text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_existing public.push_subscriptions%rowtype; v_subscription_id uuid;
begin
  if p_endpoint !~ '^https://[^[:space:]]+$' or p_endpoint_hash !~ '^[0-9a-f]{64}$'
    or p_endpoint_hash<>encode(extensions.digest(p_endpoint,'sha256'),'hex')
    or length(p_p256dh) not between 20 and 200 or length(p_auth_secret) not between 8 and 100 then raise exception 'invalid push subscription'; end if;
  if not exists(select 1 from public.app_users app_user where app_user.id=p_app_user_id and app_user.status='active') then raise exception 'active app user required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_endpoint_hash,0));
  select subscription.* into v_existing from public.push_subscriptions subscription where subscription.endpoint_hash=p_endpoint_hash for update;
  if found and v_existing.app_user_id<>p_app_user_id then
    if exists(select 1 from public.notification_delivery_outbox delivery where delivery.subscription_id=v_existing.id and delivery.status='processing') then raise exception using errcode='55P03',message='push subscription transfer is busy'; end if;
    update public.notification_delivery_outbox delivery set status='failed',available_at='infinity'::timestamptz,last_error_code='SUBSCRIPTION_OWNER_CHANGED'
      where delivery.subscription_id=v_existing.id and delivery.status in ('pending','failed');
    update public.push_subscriptions subscription set app_user_id=p_app_user_id,endpoint=p_endpoint,p256dh=p_p256dh,auth_secret=p_auth_secret,user_agent=p_user_agent,disabled_at=null
      where subscription.id=v_existing.id returning subscription.id into v_subscription_id;
  elsif found then
    update public.push_subscriptions subscription set endpoint=p_endpoint,p256dh=p_p256dh,auth_secret=p_auth_secret,user_agent=p_user_agent,disabled_at=null
      where subscription.id=v_existing.id returning subscription.id into v_subscription_id;
  else
    insert into public.push_subscriptions(app_user_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent)
      values(p_app_user_id,p_endpoint,p_endpoint_hash,p_p256dh,p_auth_secret,p_user_agent)
      returning push_subscriptions.id into v_subscription_id;
  end if;
  perform public.backfill_notification_deliveries(now(),p_app_user_id);
  return true;
end $$;

revoke all on function public.register_push_subscription(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_push_subscription(uuid,text,text,text,text,text) to service_role;
