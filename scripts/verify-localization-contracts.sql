do $$
begin
  if to_regprocedure('public.claim_notification_deliveries(text,integer,integer)') is null
    or to_regprocedure('public.claim_localized_notification_deliveries(text,integer,integer)') is null then
    raise exception 'legacy and localized push claims must coexist';
  end if;
  if to_regprocedure('public.read_celebrity_fanpage(text)') is null
    or to_regprocedure('public.read_celebrity_fanpage(text,public.content_locale)') is null
    or to_regprocedure('public.read_celebrity_fan_leaderboard(text,uuid)') is null
    or to_regprocedure('public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale)') is null then
    raise exception 'legacy and localized fanpage reads must coexist';
  end if;
  if to_regprocedure('public.get_owned_benefit_rewards(uuid)') is null
    or to_regprocedure('public.get_owned_benefit_rewards(uuid,public.content_locale)') is null then
    raise exception 'legacy and localized reward reads must coexist';
  end if;
  if public.localized_certification_category('팬 인증','ko') <> '팬 인증'
    or public.localized_certification_category('팬 인증','en') <> 'Fan Certification'
    or public.localized_certification_category('미등록 범주','en') <> 'Fan activity' then
    raise exception 'certification category locale mapping is invalid';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='instagram_connection_flows'
      and column_name='locale' and is_nullable='NO'
  ) then raise exception 'instagram flow locale is missing'; end if;
  if pg_get_function_result('public.claim_localized_notification_deliveries(text,integer,integer)'::regprocedure)
    not like '%locale text%' then
    raise exception 'localized push claim must return locale';
  end if;
  perform count(*) from public.claim_localized_notification_deliveries('locale-assert',1,30);
  if pg_get_functiondef('public.create_external_notification_plan(uuid,timestamp with time zone)'::regprocedure)
    like '%case when v_primary.kind=%email%then v_locale else %ko%end%' then
    raise exception 'primary Kakao locale is still forced to Korean';
  end if;
  if pg_get_functiondef('public.claim_external_notification_deliveries(text,integer,integer,timestamp with time zone)'::regprocedure)
    !~ 'build_external_notification_payload\(claimed\.notification_id, *claimed\.locale\)' then
    raise exception 'external channels must share the locale payload builder';
  end if;
end $$;

begin;

insert into public.app_users(id,privy_user_id,verified_email,preferred_locale)
values('91cc7a58-4a4b-4df8-a861-8583af138322','did:privy:locale-plan-fixture','locale-plan-fixture@example.test','en');

insert into public.fan_notification_channels(
  id,app_user_id,kind,status,consent_version,consented_at,destination_fingerprint,
  destination_label,verified_at,priority
) values(
  '9bff0854-142e-4c79-a10b-93f4a10f2d86','91cc7a58-4a4b-4df8-a861-8583af138322',
  'kakao','eligible','locale-contract-v1',pg_catalog.now(),repeat('a',64),'locale fixture',
  pg_catalog.now(),100
);

insert into public.fan_notifications(
  id,app_user_id,kind,source_key,celebrity_id,scheduled_for,source_event_id,
  target_type,target_id,deep_link,payload
)
select
  'f1e43df0-06d6-45b8-a1e0-b7de5b576bac','91cc7a58-4a4b-4df8-a861-8583af138322',
  'level_up','locale-plan-snapshot-fixture',celebrity.id,pg_catalog.now(),
  'e97a37ee-9fac-4e77-b96e-6e2fb682ddda','celebrity',celebrity.id,'/passports',
  jsonb_build_object('schemaVersion',1,'celebrityId',celebrity.id)
from public.celebrities celebrity
order by celebrity.id
limit 1;

do $$
begin
  if not exists(
    select 1 from public.notification_delivery_plans plan
    where plan.notification_id='f1e43df0-06d6-45b8-a1e0-b7de5b576bac'
      and plan.email_locale='en'
  ) then raise exception 'English delivery plan fixture was not created'; end if;
end $$;

update public.app_users
set preferred_locale='ko'
where id='91cc7a58-4a4b-4df8-a861-8583af138322';

update public.external_notification_delivery_outbox
set locale='ko'
where notification_id='f1e43df0-06d6-45b8-a1e0-b7de5b576bac' and channel='kakao';

update public.external_notification_delivery_outbox delivery
set locale=plan.email_locale,updated_at=pg_catalog.now()
from public.notification_delivery_plans plan
where plan.id=delivery.plan_id and delivery.channel='kakao'
  and delivery.status in('pending','failed');

do $$
begin
  if (select delivery.locale
      from public.external_notification_delivery_outbox delivery
      where delivery.notification_id='f1e43df0-06d6-45b8-a1e0-b7de5b576bac'
        and delivery.channel='kakao') <> 'en' then
    raise exception 'Kakao repair ignored the delivery plan locale snapshot';
  end if;
end $$;

rollback;
