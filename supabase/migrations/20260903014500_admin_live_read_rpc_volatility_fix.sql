-- These RPCs authorize through require_live_manager_actor(), which takes a
-- row lock. Mark them VOLATILE so PostgREST does not run them in a read-only
-- transaction where SELECT ... FOR SHARE is rejected with SQLSTATE 25006.

alter function public.get_admin_live_reward_settings(uuid,uuid,uuid) volatile;
alter function public.get_admin_live_attendance_settings(uuid,uuid,uuid) volatile;
