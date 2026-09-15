-- Include the current activity-ticket policy in the approval preview. Actual awards
-- remain owned by the shared certification review and activity reward triggers.
create or replace function public.claim_telegram_certification_delivery(p_chat_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings; selected public.telegram_certification_deliveries; t timestamptz:=clock_timestamp(); payload jsonb;
begin
  perform public.maintain_telegram_certification_reviews();
  select * into strict cfg from public.telegram_certification_review_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.next_send_at>t
    or (cfg.lease_expires_at is not null and cfg.lease_expires_at>t) then return null; end if;
  select * into selected from public.telegram_certification_deliveries
    where status='pending' and available_at<=t and attempt_count<3
      and activation_id=cfg.activation_id and chat_id=cfg.chat_id
    order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.telegram_certification_deliveries set status='claimed',attempt_count=attempt_count+1,
    lease_token=extensions.gen_random_bytes(16),lease_expires_at=t+interval '2 minutes' where id=selected.id returning * into selected;
  update public.telegram_certification_review_settings set leased_delivery_id=selected.id,
    lease_expires_at=selected.lease_expires_at where singleton;
  insert into public.telegram_certification_upload_deliveries(delivery_id,upload_id,upload_order)
    select selected.id,u.id,row_number() over(order by u.created_at,u.id)::integer
    from public.certification_uploads u where u.consumed_submission_id=selected.submission_id
    on conflict(delivery_id,upload_id) do nothing;
  select jsonb_build_object(
    'delivery_id',selected.id,'submission_id',s.id,'callback_token',encode(selected.callback_token,'hex'),
    'lease_token',encode(selected.lease_token,'hex'),'action_message_id',selected.action_message_id,
    'expected_review_revision',selected.expected_review_revision,
    'creator_name',coalesce(cko.name,cen.name,c.slug),'mission_title',coalesce(m.title_ko,m.title_en),
    'membership_platform',s.membership_platform,'applicant_nickname',p.nickname,
    'attempt_number',s.attempt_number,'submitted_at',s.submitted_at,'note',s.note,
    'reward',jsonb_build_object('score_points',s.reward_score_points,'ticket_amount',s.reward_ticket_amount + case when s.membership_platform is not null
      and exists(select 1 from public.fan_ticket_activity_policy ap where ap.celebrity_id=s.celebrity_id and ap.enabled)
      and c.status='published' and c.archived_at is null
      and exists(select 1 from public.app_users au where au.id=s.app_user_id and au.status='active')
      and not exists(select 1 from public.fan_ticket_activity_awards aw where aw.app_user_id=s.app_user_id
        and aw.celebrity_id=s.celebrity_id and aw.action_key='membership_'||s.membership_platform::text and aw.scope_key='once')
      then 1 else 0 end,
      'stamp_count',case when s.membership_platform is null then 0 else 1 end),
    'uploads',coalesce((select jsonb_agg(jsonb_build_object('upload_id',u.id,'upload_order',du.upload_order,
      'object_path',u.object_path,'content_type',u.content_type,'width',u.width,'height',u.height,
      'delivery_status',du.status,'provider_message_id',du.provider_message_id)
      order by du.upload_order) from public.telegram_certification_upload_deliveries du
      join public.certification_uploads u on u.id=du.upload_id where du.delivery_id=selected.id),'[]'::jsonb)
  ) into payload
  from public.certification_submissions s
  join public.certification_missions m on m.id=s.mission_id
  join public.celebrities c on c.id=s.celebrity_id
  left join public.celebrity_localizations cko on cko.celebrity_id=c.id and cko.locale='ko'
  left join public.celebrity_localizations cen on cen.celebrity_id=c.id and cen.locale='en'
  left join public.user_profiles p on p.app_user_id=s.app_user_id where s.id=selected.submission_id;
  return payload;
end $$;
