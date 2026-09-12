-- Existing behavioral fixtures predate the release window. Enable only in
-- this disposable local harness; production configure never accepts a cutoff.
do $$ begin if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local only'; end if; end $$;
update public.fan_notification_delivery_control set mode='enabled',activated_at='-infinity';
\ir security_function_privileges.sql
\ir mint_dispatch_budget.sql
\ir kakao_alimtalk.sql
\ir phone_sms_enrollment.sql
\ir welcome_notices.sql
