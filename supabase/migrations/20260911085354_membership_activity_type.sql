-- Commit this additive enum value before using it in functions/constraints.
alter type public.fan_activity_type add value if not exists 'membership';
