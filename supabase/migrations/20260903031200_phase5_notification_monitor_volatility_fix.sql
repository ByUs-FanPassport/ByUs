-- The shared Admin actor assertion takes FOR SHARE locks, so PostgREST must not
-- execute this read RPC inside a read-only transaction.
alter function public.get_admin_notification_deliveries(
  uuid,
  uuid,
  public.notification_delivery_status,
  integer
) volatile;
