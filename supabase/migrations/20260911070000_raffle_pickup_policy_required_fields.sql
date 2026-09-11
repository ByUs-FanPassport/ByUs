-- Enforce complete on-site pickup instructions without changing policy-less
-- legacy campaign items.

alter table public.raffle_fulfillment_policies
  add constraint raffle_fulfillment_policy_pickup_required_fields check (
    method<>'on_site_pickup' or (
      pickup_ends_on is not null
      and length(btrim(pickup_venue_ko))>0
      and length(btrim(pickup_venue_en))>0
      and length(btrim(pickup_instructions_ko))>0
      and length(btrim(pickup_instructions_en))>0
    )
  );
