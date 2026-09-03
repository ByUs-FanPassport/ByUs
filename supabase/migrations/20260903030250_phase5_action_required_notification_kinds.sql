-- Enum additions commit separately before action-required constraints/functions use them.
alter type public.notification_kind add value if not exists 'benefit_won';
alter type public.notification_kind add value if not exists 'recipient_information_required';
alter type public.notification_kind add value if not exists 'fulfillment_meaningful_update';
alter type public.notification_kind add value if not exists 'collectible_claim_available';
alter type public.notification_kind add value if not exists 'collectible_claim_expiring';
