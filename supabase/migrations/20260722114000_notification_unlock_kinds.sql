-- Enum additions must commit before the following migration can use them.
alter type public.notification_kind add value if not exists 'level_up';
alter type public.notification_kind add value if not exists 'benefit_unlocked';
