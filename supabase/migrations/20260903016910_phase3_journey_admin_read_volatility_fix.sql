-- The Journey Admin read authorizes through a row lock. Mark it VOLATILE so
-- PostgREST does not execute it in a read-only transaction where FOR SHARE is
-- rejected with SQLSTATE 25006.

alter function public.get_admin_live_journey_requirements(uuid,uuid,uuid) volatile;
