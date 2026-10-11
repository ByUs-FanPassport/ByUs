-- Enum values must commit before the following migration can use them.
alter type public.celebrity_primary_role add value 'brand';
alter type public.celebrity_role add value 'brand';
