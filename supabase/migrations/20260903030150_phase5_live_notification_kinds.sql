-- Enum additions commit separately because PostgreSQL cannot use new enum values in the same transaction.
alter type public.notification_kind add value if not exists 'live_reserved';
alter type public.notification_kind add value if not exists 'live_changed';
alter type public.notification_kind add value if not exists 'live_cancelled';
