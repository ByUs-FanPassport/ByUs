-- Keep reminder source keys inside fan_notifications_source_key_safe while
-- preserving the winner + immutable policy + captured deadline identity.

create function public.benefit_recipient_reminder_source_key(
  p_winner_id uuid,p_policy_version text,p_deadline_at timestamptz
) returns text language sql immutable security definer set search_path='' as $$
  select 'recipient_deadline_reminder:'||encode(extensions.digest(
    p_winner_id::text||'|'||p_policy_version||'|'
      ||extract(epoch from p_deadline_at)::numeric::text,
    'sha256'),'hex');
$$;

create or replace function public.enqueue_due_benefit_recipient_reminders(
  p_now timestamptz default pg_catalog.now()
) returns integer language plpgsql security definer set search_path='' as $$
declare due record; v_count integer:=0; v_source text;
begin
  for due in
    select winner.id winner_id,winner.app_user_id,winner.benefit_id,
      fulfillment.fulfillment_policy_version,fulfillment.recipient_deadline_at
    from public.benefit_draw_winners winner
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    where fulfillment.claim_disposition='active'
      and fulfillment.fulfillment_policy_version is not null
      and fulfillment.recipient_deadline_at>p_now
      and fulfillment.recipient_deadline_at<=p_now+interval '24 hours'
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  loop
    v_source:=public.benefit_recipient_reminder_source_key(
      due.winner_id,due.fulfillment_policy_version,due.recipient_deadline_at);
    if not exists(select 1 from public.fan_notifications notification
      where notification.app_user_id=due.app_user_id and notification.source_key=v_source) then
      perform public.insert_action_required_notification(
        due.app_user_id,'recipient_information_required',v_source,null,due.benefit_id,
        '/benefits/'||due.benefit_id::text,
        jsonb_build_object('title','수령 정보 입력 마감 임박',
          'detail','수령 정보를 24시간 안에 입력해 주세요.',
          'recipientDeadlineAt',due.recipient_deadline_at),p_now);
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.notification_delivery_is_eligible(
  p_notification_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.notification_delivery_is_eligible_before_raffle_recipient_reminder(
    p_notification_id,p_at)
  and case when notification.source_key like 'recipient_deadline_reminder:%' then exists(
    select 1 from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
      and notification.source_key=public.benefit_recipient_reminder_source_key(
        winner.id,fulfillment.fulfillment_policy_version,fulfillment.recipient_deadline_at)
      and fulfillment.claim_disposition='active'
      and fulfillment.recipient_deadline_at>p_at
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  ) else true end
  from public.fan_notifications notification where notification.id=p_notification_id;
$$;

create or replace function public.email_notification_delivery_is_eligible(
  p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible_before_raffle_recipient_reminder(
    p_notification_id,p_channel_id,p_at)
  and case when notification.source_key like 'recipient_deadline_reminder:%' then exists(
    select 1 from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
      and notification.source_key=public.benefit_recipient_reminder_source_key(
        winner.id,fulfillment.fulfillment_policy_version,fulfillment.recipient_deadline_at)
      and fulfillment.claim_disposition='active'
      and fulfillment.recipient_deadline_at>p_at
      and not exists(select 1 from public.benefit_recipient_private recipient
        where recipient.winner_id=winner.id)
  ) else true end
  from public.fan_notifications notification where notification.id=p_notification_id;
$$;

revoke all on function public.benefit_recipient_reminder_source_key(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.enqueue_due_benefit_recipient_reminders(timestamptz),
  public.notification_delivery_is_eligible(uuid,timestamptz),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.enqueue_due_benefit_recipient_reminders(timestamptz),
  public.notification_delivery_is_eligible(uuid,timestamptz),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  to service_role;
