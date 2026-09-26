-- Keep CS's existing 403 contract around the account-deletion write fence.
-- Preserve the common actor lock, private delegate, arguments/defaults and grants.
do $$
declare signature regprocedure; target record; body text;
begin
  foreach signature in array array[
    'public.cs_create(uuid,text,text,text,uuid)'::regprocedure,
    'public.cs_post(uuid,uuid,text,uuid,uuid,uuid)'::regprocedure,
    'public.cs_resolve(uuid,uuid,uuid,integer,uuid)'::regprocedure
  ] loop
    select proname,prosrc into strict target from pg_proc where oid=signature;
    if position('perform public.fan_web_lock_active_user(p_app_user_id);' in target.prosrc)=0
      or position('return public.'||target.proname||'_fw_' in target.prosrc)=0 then
      raise exception 'Expected account-deletion wrapper for %',signature;
    end if;
    body:=regexp_replace(target.prosrc,'[[:space:]]end[[:space:]]*$', $body$
exception when insufficient_privilege then
  if sqlerrm='FAN_WEB_ACTIVE_ACCOUNT_REQUIRED' then
    raise exception 'CS_FORBIDDEN' using errcode='42501';
  end if;
  raise;
end
$body$);
    if body=target.prosrc then raise exception 'Unexpected wrapper body for %',signature; end if;
    execute format('create or replace function public.%I(%s) returns jsonb language plpgsql security definer set search_path='''' as %L',
      target.proname,pg_get_function_arguments(signature),body);
  end loop;
end $$;
