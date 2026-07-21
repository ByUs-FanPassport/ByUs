-- Correct the Dev-applied projector. The original migration is also fixed so
-- fresh databases and upgraded environments converge on this exact body.
create or replace function public.project_benefit_unlock_events(p_source_ledger_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  source_ledger public.fan_score_ledger%rowtype;
  previous_score integer;
  current_score integer;
  previous_level text;
  current_level text;
  benefit_record record;
  change_id uuid;
  created_notification_id uuid;
begin
  select * into source_ledger from public.fan_score_ledger where id=p_source_ledger_id;
  if not found then raise exception 'score ledger source is required'; end if;
  select coalesce(sum(points),0)::integer into current_score from public.fan_score_ledger
    where app_user_id=source_ledger.app_user_id and celebrity_id=source_ledger.celebrity_id;
  previous_score:=current_score-source_ledger.points;
  previous_level:=public.fan_level_for_score(previous_score);
  current_level:=public.fan_level_for_score(current_score);
  for benefit_record in
    select benefit.id,benefit.slug,benefit.revision from public.benefits benefit
    where benefit.celebrity_id=source_ledger.celebrity_id and benefit.publication_status='published' and benefit.archived_at is null
      and source_ledger.created_at>=benefit.claim_opens_at and source_ledger.created_at<benefit.claim_closes_at
      and (benefit.stock_limit is null or (select count(*) from public.benefit_claims claim where claim.benefit_id=benefit.id)<benefit.stock_limit)
      and (benefit.delivery_type<>'unique_code' or exists(select 1 from public.benefit_unique_codes code where code.benefit_id=benefit.id and code.claimed_by_claim_id is null))
      and not exists(select 1 from public.benefit_claims claim where claim.benefit_id=benefit.id and claim.app_user_id=source_ledger.app_user_id)
      and current_score>=benefit.minimum_score and public.fan_level_rank(current_level)>=public.fan_level_rank(benefit.minimum_level)
      and (benefit.required_stamp_type is null or exists(select 1 from public.stamps stamp where stamp.app_user_id=source_ledger.app_user_id and stamp.celebrity_id=source_ledger.celebrity_id and stamp.stamp_type=benefit.required_stamp_type))
      and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities activity where activity.app_user_id=source_ledger.app_user_id and activity.celebrity_id=source_ledger.celebrity_id and activity.activity_type=benefit.required_activity_type))
      and not (
        previous_score>=benefit.minimum_score and public.fan_level_rank(previous_level)>=public.fan_level_rank(benefit.minimum_level)
        and (benefit.required_stamp_type is null or exists(select 1 from public.stamps prior_stamp where prior_stamp.app_user_id=source_ledger.app_user_id and prior_stamp.celebrity_id=source_ledger.celebrity_id and prior_stamp.stamp_type=benefit.required_stamp_type and prior_stamp.activity_id is distinct from source_ledger.activity_id))
        and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities prior_activity where prior_activity.app_user_id=source_ledger.app_user_id and prior_activity.celebrity_id=source_ledger.celebrity_id and prior_activity.activity_type=benefit.required_activity_type and prior_activity.id is distinct from source_ledger.activity_id))
      ) order by benefit.id
  loop
    change_id:=extensions.gen_random_uuid();
    insert into public.benefit_eligibility_changes(id,source_ledger_id,app_user_id,celebrity_id,benefit_id,benefit_policy_version,previous_state,current_state,previous_score,current_score,occurred_at)
    values(change_id,source_ledger.id,source_ledger.app_user_id,source_ledger.celebrity_id,benefit_record.id,benefit_record.revision,'locked','eligible',previous_score,current_score,source_ledger.created_at)
    on conflict(app_user_id,benefit_id,benefit_policy_version) do nothing returning id into change_id;
    if change_id is null then continue; end if;
    created_notification_id:=extensions.gen_random_uuid();
    insert into public.fan_notifications(id,app_user_id,kind,source_key,benefit_id,scheduled_for,celebrity_id,source_event_id,target_type,target_id,deep_link,payload,created_at)
    values(created_notification_id,source_ledger.app_user_id,'benefit_unlocked','benefit:'||benefit_record.id::text||':policy:'||benefit_record.revision::text,benefit_record.id,source_ledger.created_at,source_ledger.celebrity_id,change_id,'benefit',benefit_record.id,'/benefits/'||benefit_record.id::text,
      jsonb_build_object('schemaVersion',1,'celebrityId',source_ledger.celebrity_id,'benefitId',benefit_record.id,'benefitSlug',benefit_record.slug,'benefitPolicyVersion',benefit_record.revision,'previousScore',previous_score,'currentScore',current_score),source_ledger.created_at)
    on conflict(app_user_id,source_key) do nothing returning id into created_notification_id;
    if created_notification_id is not null then
      insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
      select created_notification_id,subscription.id,source_ledger.created_at from public.push_subscriptions subscription
      where subscription.app_user_id=source_ledger.app_user_id and subscription.disabled_at is null
        and coalesce((select preference.benefit_notifications from public.notification_preferences preference where preference.app_user_id=source_ledger.app_user_id),true)
      on conflict(notification_id,subscription_id) do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function public.project_benefit_unlock_events(uuid) from public,anon,authenticated;
