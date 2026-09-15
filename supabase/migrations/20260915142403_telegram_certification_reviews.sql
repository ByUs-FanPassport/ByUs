-- Private Telegram delivery and approval path for manual certification reviews.
create type public.certification_review_source as enum ('admin_web','telegram');

alter table public.certification_submissions
  add column review_source public.certification_review_source not null default 'admin_web',
  add column reviewed_by_telegram_user_id bigint,
  add column reviewed_by_telegram_name text,
  add column reviewed_by_telegram_username text,
  drop constraint certification_submission_review_shape,
  add constraint certification_submission_review_shape check (
    (status='pending' and rejection_reason is null and reviewed_by_app_user_id is null
      and reviewed_by_admin_allowlist_id is null and reviewed_by_telegram_user_id is null
      and reviewed_by_telegram_name is null and reviewed_by_telegram_username is null
      and reviewed_at is null) or
    (status='approved' and rejection_reason is null and reviewed_at is not null and (
      (review_source='admin_web' and reviewed_by_app_user_id is not null
        and reviewed_by_admin_allowlist_id is not null and reviewed_by_telegram_user_id is null
        and reviewed_by_telegram_name is null and reviewed_by_telegram_username is null) or
      (review_source='telegram' and reviewed_by_app_user_id is null
        and reviewed_by_admin_allowlist_id is null and reviewed_by_telegram_user_id is not null
        and reviewed_by_telegram_name is not null)
    )) or
    (status='rejected' and rejection_reason is not null and reviewed_at is not null
      and review_source='admin_web' and reviewed_by_app_user_id is not null
      and reviewed_by_admin_allowlist_id is not null and reviewed_by_telegram_user_id is null
      and reviewed_by_telegram_name is null and reviewed_by_telegram_username is null)
  ),
  add constraint certification_submission_telegram_identity check (
    (reviewed_by_telegram_user_id is null or reviewed_by_telegram_user_id>0)
    and (reviewed_by_telegram_name is null or (reviewed_by_telegram_name=btrim(reviewed_by_telegram_name) and length(reviewed_by_telegram_name) between 1 and 128))
    and (reviewed_by_telegram_username is null or (reviewed_by_telegram_username=btrim(reviewed_by_telegram_username) and reviewed_by_telegram_username ~ '^[A-Za-z0-9_]{5,32}$'))
  );

create table public.telegram_certification_review_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  chat_id text check (chat_id ~ '^-[0-9]{1,19}$'),
  activation_id uuid not null default extensions.gen_random_uuid(),
  activated_at timestamptz not null default clock_timestamp(),
  next_send_at timestamptz not null default '-infinity',
  leased_delivery_id uuid,
  lease_expires_at timestamptz,
  check (not enabled or chat_id is not null)
);
insert into public.telegram_certification_review_settings(singleton) values(true);

create table public.telegram_certification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id uuid not null unique references public.certification_submissions(id) on delete restrict,
  activation_id uuid not null,
  chat_id text not null check (chat_id ~ '^-[0-9]{1,19}$'),
  callback_token bytea not null default extensions.gen_random_bytes(16) unique check (octet_length(callback_token)=16),
  expected_review_revision bigint not null check (expected_review_revision>0),
  status text not null default 'pending' check (status in ('pending','claimed','sending','sent','partial','failed','delivery_unknown','skipped')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  available_at timestamptz not null default clock_timestamp(),
  lease_token bytea unique check (lease_token is null or octet_length(lease_token)=16),
  lease_expires_at timestamptz,
  action_message_id bigint check (action_message_id is null or action_message_id>0),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
alter table public.telegram_certification_review_settings
  add constraint telegram_certification_settings_lease_fk foreign key (leased_delivery_id)
  references public.telegram_certification_deliveries(id) on delete restrict;

create table public.telegram_certification_upload_deliveries (
  delivery_id uuid not null references public.telegram_certification_deliveries(id) on delete restrict,
  upload_id uuid not null references public.certification_uploads(id) on delete restrict,
  upload_order integer not null check (upload_order between 1 and 3),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','delivery_unknown')),
  provider_message_id bigint check (provider_message_id is null or provider_message_id>0),
  sent_at timestamptz,
  primary key(delivery_id,upload_id),
  unique(delivery_id,upload_order),
  check ((status in ('pending','sending','failed','delivery_unknown') and provider_message_id is null and sent_at is null)
    or (status='sent' and provider_message_id is not null and sent_at is not null))
);

create table public.telegram_certification_review_receipts (
  delivery_id uuid primary key references public.telegram_certification_deliveries(id) on delete restrict,
  submission_id uuid not null unique references public.certification_submissions(id) on delete restrict,
  telegram_user_id bigint not null check (telegram_user_id>0),
  telegram_display_name text not null check (telegram_display_name=btrim(telegram_display_name) and length(telegram_display_name) between 1 and 128),
  telegram_username text check (telegram_username is null or (telegram_username=btrim(telegram_username) and telegram_username ~ '^[A-Za-z0-9_]{5,32}$')),
  action_message_id bigint not null check (action_message_id>0),
  outcome text not null check (outcome in ('approved','already_processed')),
  final_status public.certification_submission_status not null,
  created_at timestamptz not null default clock_timestamp()
);

create index telegram_certification_delivery_pending_idx
  on public.telegram_certification_deliveries(available_at,created_at,id) where status='pending';
create index telegram_certification_delivery_retention_idx
  on public.telegram_certification_deliveries(finished_at) where finished_at is not null;

alter table public.telegram_certification_review_settings enable row level security;
alter table public.telegram_certification_review_settings force row level security;
alter table public.telegram_certification_deliveries enable row level security;
alter table public.telegram_certification_deliveries force row level security;
alter table public.telegram_certification_upload_deliveries enable row level security;
alter table public.telegram_certification_upload_deliveries force row level security;
alter table public.telegram_certification_review_receipts enable row level security;
alter table public.telegram_certification_review_receipts force row level security;
revoke all on table public.telegram_certification_review_settings,
  public.telegram_certification_deliveries,
  public.telegram_certification_upload_deliveries,
  public.telegram_certification_review_receipts from public,anon,authenticated,service_role;

create function public.configure_telegram_certification_reviews(p_chat_id text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings; t timestamptz:=clock_timestamp();
begin
  if p_enabled is null or (p_enabled and (p_chat_id is null or p_chat_id !~ '^-[0-9]{1,19}$')) then
    raise exception 'TELEGRAM_CERTIFICATION_CONFIG_INVALID';
  end if;
  if p_enabled and not exists(
    select 1 from public.telegram_alert_settings a
    cross join public.telegram_command_settings c
    where a.singleton and a.enabled and a.chat_id=p_chat_id and c.singleton and c.enabled
  ) then
    raise exception 'TELEGRAM_CERTIFICATION_SHARED_TELEGRAM_NOT_READY';
  end if;
  select * into strict cfg from public.telegram_certification_review_settings where singleton for update;
  if cfg.enabled=p_enabled and cfg.chat_id is not distinct from p_chat_id then return; end if;
  update public.telegram_certification_deliveries
    set status=case when status in ('sending','partial') then 'delivery_unknown' else 'skipped' end,
        last_error=case when status in ('sending','partial') then 'DELIVERY_UNKNOWN' else last_error end,
        lease_token=null,lease_expires_at=null,finished_at=t
    where status in ('pending','claimed','sending','partial');
  update public.telegram_certification_review_settings set enabled=p_enabled,chat_id=p_chat_id,
    activation_id=extensions.gen_random_uuid(),activated_at=t,next_send_at='-infinity',
    leased_delivery_id=null,lease_expires_at=null where singleton;
end $$;

create function public.capture_telegram_certification_submission() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings;
begin
  if new.status<>'pending' then return new; end if;
  select * into cfg from public.telegram_certification_review_settings where singleton;
  if not coalesce(cfg.enabled,false) then return new; end if;
  insert into public.telegram_certification_deliveries(submission_id,activation_id,chat_id,expected_review_revision)
    values(new.id,cfg.activation_id,cfg.chat_id,new.review_revision) on conflict(submission_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_CERTIFICATION_CAPTURE_FAILED sqlstate=%',sqlstate;
  return new;
end $$;
create trigger certification_submissions_telegram_review
after insert on public.certification_submissions for each row execute function public.capture_telegram_certification_submission();

create function public.maintain_telegram_certification_reviews() returns void
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings; t timestamptz:=clock_timestamp();
begin
  select * into strict cfg from public.telegram_certification_review_settings where singleton for update;
  update public.telegram_certification_upload_deliveries u set status='delivery_unknown'
    from public.telegram_certification_deliveries d
    where u.delivery_id=d.id and u.status='sending' and d.status='sending' and d.lease_expires_at<=t;
  update public.telegram_certification_deliveries d set
    status=case
      when d.status in ('claimed','partial') and d.attempt_count<3 then 'pending'
      when d.status in ('claimed','partial') then 'failed'
      else 'delivery_unknown' end,
    last_error=case when d.status in ('claimed','partial') and d.attempt_count<3 then d.last_error
      when d.status in ('claimed','partial') then 'CLAIM_TIMEOUT' else 'DELIVERY_UNKNOWN' end,
    lease_token=null,lease_expires_at=null,
    finished_at=case when d.status in ('claimed','partial') and d.attempt_count<3 then null else t end
    where d.status in ('claimed','sending','partial') and d.lease_expires_at<=t;
  update public.telegram_certification_deliveries set status='skipped',lease_token=null,lease_expires_at=null,finished_at=t
    where status in ('pending','claimed') and (not cfg.enabled or activation_id<>cfg.activation_id
      or chat_id is distinct from cfg.chat_id or created_at<t-interval '1 day');
  update public.telegram_certification_review_settings set leased_delivery_id=null,lease_expires_at=null
    where singleton and lease_expires_at<=t;
  delete from public.telegram_certification_review_receipts r using public.telegram_certification_deliveries d
    where r.delivery_id=d.id and d.finished_at<t-interval '30 days';
  delete from public.telegram_certification_upload_deliveries u using public.telegram_certification_deliveries d
    where u.delivery_id=d.id and d.finished_at<t-interval '30 days';
  delete from public.telegram_certification_deliveries where finished_at<t-interval '30 days';
end $$;

create function public.claim_telegram_certification_delivery(p_chat_id text) returns jsonb
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
    'reward',jsonb_build_object('score_points',s.reward_score_points,'ticket_amount',s.reward_ticket_amount,
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

create function public.record_telegram_certification_delivery(
  p_delivery_id uuid,p_chat_id text,p_lease_token text,p_outcome text,p_upload_id uuid,
  p_upload_order integer,p_provider_message_id bigint default null,
  p_retry_after integer default null,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings; d public.telegram_certification_deliveries; u public.telegram_certification_upload_deliveries; t timestamptz:=clock_timestamp(); complete boolean;
begin
  select * into strict cfg from public.telegram_certification_review_settings where singleton for update;
  select * into d from public.telegram_certification_deliveries where id=p_delivery_id for update;
  if p_lease_token is null or p_lease_token !~ '^[0-9a-f]{32}$' or not found
    or d.chat_id is distinct from p_chat_id or cfg.chat_id is distinct from p_chat_id
    or cfg.leased_delivery_id is distinct from p_delivery_id or d.lease_expires_at<=t
    or d.lease_token is distinct from decode(p_lease_token,'hex')
    or d.status not in ('claimed','sending','partial') then return jsonb_build_object('accepted',false,'status',coalesce(d.status,'missing')); end if;
  if p_upload_id is null or p_upload_order is null then raise exception 'TELEGRAM_CERTIFICATION_DELIVERY_ARGUMENT_INVALID'; end if;
  select * into u from public.telegram_certification_upload_deliveries
    where delivery_id=d.id and upload_id=p_upload_id and upload_order=p_upload_order for update;
  if not found then raise exception 'TELEGRAM_CERTIFICATION_UPLOAD_INVALID'; end if;
  if p_outcome='sending' then
    if p_provider_message_id is not null or d.status not in ('claimed','partial') or u.status<>'pending' then
      return jsonb_build_object('accepted',false,'status',d.status);
    end if;
    if p_upload_order<>1 and (d.action_message_id is null or exists(
      select 1 from public.telegram_certification_upload_deliveries prior
      where prior.delivery_id=d.id and prior.upload_order<p_upload_order and prior.status<>'sent'
    )) then raise exception 'TELEGRAM_CERTIFICATION_ACTION_MESSAGE_REQUIRED'; end if;
    update public.telegram_certification_upload_deliveries set status='sending' where delivery_id=d.id and upload_id=p_upload_id;
    update public.telegram_certification_deliveries set status='sending' where id=d.id;
  elsif p_outcome='sent' then
    if d.status<>'sending' or u.status<>'sending' or p_provider_message_id is null or p_provider_message_id<=0 then raise exception 'TELEGRAM_CERTIFICATION_DELIVERY_ARGUMENT_INVALID'; end if;
    update public.telegram_certification_upload_deliveries set status='sent',provider_message_id=p_provider_message_id,sent_at=t
      where delivery_id=d.id and upload_id=p_upload_id;
    if p_upload_order=1 then
      update public.telegram_certification_deliveries set action_message_id=p_provider_message_id where id=d.id and action_message_id is null;
    end if;
    select not exists(select 1 from public.telegram_certification_upload_deliveries where delivery_id=d.id and status<>'sent') into complete;
    update public.telegram_certification_deliveries set status=case when complete then 'sent' else 'partial' end,
      lease_token=case when complete then null else lease_token end,
      lease_expires_at=case when complete then null else lease_expires_at end,
      finished_at=case when complete then t else null end where id=d.id;
    if complete then update public.telegram_certification_review_settings set leased_delivery_id=null,lease_expires_at=null where singleton; end if;
  elsif p_outcome='throttled' then
    if d.status<>'sending' or u.status<>'sending' or p_provider_message_id is not null then raise exception 'TELEGRAM_CERTIFICATION_DELIVERY_ARGUMENT_INVALID'; end if;
    if d.attempt_count>=3 then
      update public.telegram_certification_upload_deliveries set status='failed' where delivery_id=d.id and upload_id=p_upload_id;
      update public.telegram_certification_deliveries set status='failed',last_error='THROTTLED',lease_token=null,lease_expires_at=null,finished_at=t where id=d.id;
    else
      update public.telegram_certification_upload_deliveries set status='pending' where delivery_id=d.id and upload_id=p_upload_id;
      update public.telegram_certification_deliveries set status='pending',last_error='THROTTLED',lease_token=null,lease_expires_at=null,
        available_at=t+make_interval(secs=>greatest(1,least(coalesce(p_retry_after,1),3600))) where id=d.id;
      update public.telegram_certification_review_settings set next_send_at=t+make_interval(secs=>greatest(1,least(coalesce(p_retry_after,1),3600))) where singleton;
    end if;
    update public.telegram_certification_review_settings set leased_delivery_id=null,lease_expires_at=null where singleton;
  elsif p_outcome in ('rejected','delivery_unknown') then
    if d.status<>'sending' or u.status<>'sending' or p_provider_message_id is not null then raise exception 'TELEGRAM_CERTIFICATION_DELIVERY_ARGUMENT_INVALID'; end if;
    update public.telegram_certification_upload_deliveries set status=case when p_outcome='rejected' then 'failed' else 'delivery_unknown' end
      where delivery_id=d.id and upload_id=p_upload_id;
    update public.telegram_certification_deliveries set status=case when p_outcome='rejected' then 'failed' else 'delivery_unknown' end,
      last_error=case when p_outcome='rejected' then left(coalesce(p_error_code,'REJECTED'),120) else 'DELIVERY_UNKNOWN' end,
      lease_token=null,lease_expires_at=null,finished_at=t where id=d.id;
    update public.telegram_certification_review_settings set leased_delivery_id=null,lease_expires_at=null where singleton;
  else raise exception 'TELEGRAM_CERTIFICATION_OUTCOME_INVALID'; end if;
  select * into strict d from public.telegram_certification_deliveries where id=p_delivery_id;
  return jsonb_build_object('accepted',true,'status',d.status,'complete',d.status='sent','attempt_count',d.attempt_count);
end $$;

create function public.finalize_certification_review_internal(
  p_submission_id uuid,p_expected_revision bigint,p_decision public.certification_submission_status,p_rejection_reason text,
  p_review_source public.certification_review_source,p_actor uuid,p_allowlist uuid,
  p_telegram_user_id bigint,p_telegram_name text,p_telegram_username text,p_correlation uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare submission public.certification_submissions%rowtype; result jsonb; passport_id uuid; recipient text; celebrity_slug text;
  activity_id uuid; stamp_id uuid; job_id uuid; operation_key text; issuance_id text;
begin
  if p_decision not in ('approved','rejected') or (p_decision='rejected')<>(p_rejection_reason is not null) then raise exception 'CERTIFICATION_DECISION_INVALID'; end if;
  if (p_review_source='admin_web' and (p_actor is null or p_allowlist is null or p_telegram_user_id is not null or p_telegram_name is not null or p_telegram_username is not null))
    or (p_review_source='telegram' and (p_decision<>'approved' or p_actor is not null or p_allowlist is not null or p_telegram_user_id is null or p_telegram_name is null)) then
    raise exception 'CERTIFICATION_REVIEW_ACTOR_INVALID';
  end if;
  select * into strict submission from public.certification_submissions where id=p_submission_id for update;
  if submission.status<>'pending' or submission.review_revision<>p_expected_revision then raise exception 'CERTIFICATION_STALE_REVISION'; end if;
  if p_decision='approved' and exists(select 1 from public.certification_submissions where app_user_id=submission.app_user_id and mission_id=submission.mission_id and status='approved' and id<>submission.id) then raise exception 'CERTIFICATION_ALREADY_APPROVED'; end if;
  if p_decision='approved' and submission.membership_platform is not null then
    select id into passport_id from public.fan_passports where app_user_id=submission.app_user_id and celebrity_id=submission.celebrity_id and business_status='issued' for key share;
    if passport_id is null then raise exception 'CERTIFICATION_PASSPORT_REQUIRED'; end if;
    select address into recipient from public.user_wallets where app_user_id=submission.app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
    if recipient is null then raise exception 'CERTIFICATION_MEMBERSHIP_WALLET_NOT_READY'; end if;
    select slug into strict celebrity_slug from public.celebrities where id=submission.celebrity_id;
  end if;
  update public.certification_submissions set status=p_decision,rejection_reason=p_rejection_reason,
    review_source=p_review_source,reviewed_by_app_user_id=p_actor,reviewed_by_admin_allowlist_id=p_allowlist,
    reviewed_by_telegram_user_id=p_telegram_user_id,reviewed_by_telegram_name=p_telegram_name,
    reviewed_by_telegram_username=p_telegram_username,reviewed_at=now(),review_revision=review_revision+1,updated_at=now()
    where id=submission.id returning * into submission;
  if p_decision='approved' then
    if submission.membership_platform is not null then
      activity_id:=extensions.gen_random_uuid();stamp_id:=extensions.gen_random_uuid();job_id:=extensions.gen_random_uuid();
      operation_key:='byus:stamp:v1:'||stamp_id::text;issuance_id:='0x'||encode(extensions.digest(operation_key,'sha256'),'hex');
      insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
        values(activity_id,submission.app_user_id,submission.celebrity_id,'membership','certification_submission',submission.id);
    end if;
    if submission.reward_score_points>0 then insert into public.fan_score_ledger(app_user_id,celebrity_id,points,manual_submission_id) values(submission.app_user_id,submission.celebrity_id,submission.reward_score_points,submission.id); end if;
    if submission.reward_ticket_amount>0 then perform public.post_fan_ticket_entry(submission.app_user_id,submission.celebrity_id,'credit',submission.reward_ticket_amount,'manual_certification',submission.id,submission.id,submission.reward_policy_version,null,null); end if;
  end if;
  if p_decision='approved' and submission.membership_platform is not null then
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
      values(job_id,'stamp',stamp_id,operation_key,1,jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'issuanceId',issuance_id,'stampType','Membership'));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id)
      values(stamp_id,submission.app_user_id,submission.celebrity_id,passport_id,activity_id,'membership',job_id);
  end if;
  result:=jsonb_build_object('id',submission.id,'status',submission.status,'revision',submission.review_revision,'replayed',false);
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor,p_allowlist,'certification.submission.'||submission.status,'certification_submission',submission.id::text,p_correlation,
      jsonb_build_object('revision',submission.review_revision,'reason',p_rejection_reason,'reviewSource',p_review_source,
        'telegram',case when p_review_source='telegram' then jsonb_build_object('userId',p_telegram_user_id,'displayName',p_telegram_name,'username',p_telegram_username) else null end,
        'reward',jsonb_build_object('scorePoints',submission.reward_score_points,'ticketAmount',submission.reward_ticket_amount,
          'stampCount',case when submission.membership_platform is null then 0 else 1 end)));
  return result;
end $$;

create or replace function public.review_admin_certification_submission(p_actor uuid,p_allowlist uuid,p_correlation uuid,p_submission_id uuid,p_idempotency_key uuid,p_expected_revision bigint,p_decision text,p_rejection_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare operation public.certification_review_operations%rowtype; result jsonb; decision public.certification_submission_status; reason text;
begin
  perform public.assert_certification_admin(p_actor,p_allowlist);
  if p_decision not in ('approve','reject') then raise exception 'CERTIFICATION_DECISION_INVALID'; end if;
  decision:=case p_decision when 'approve' then 'approved'::public.certification_submission_status else 'rejected'::public.certification_submission_status end;
  reason:=nullif(btrim(coalesce(p_rejection_reason,'')),'');
  if (decision='rejected')<>(reason is not null) then raise exception 'CERTIFICATION_REJECTION_REASON_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certification:review:key:'||p_idempotency_key::text,0));
  select * into operation from public.certification_review_operations where idempotency_key=p_idempotency_key;
  if found then
    if operation.submission_id<>p_submission_id or operation.expected_revision<>p_expected_revision or operation.decision<>decision or operation.rejection_reason is distinct from reason then raise exception 'CERTIFICATION_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    return operation.result||jsonb_build_object('replayed',true);
  end if;
  result:=public.finalize_certification_review_internal(p_submission_id,p_expected_revision,decision,reason,'admin_web',p_actor,p_allowlist,null,null,null,p_correlation);
  insert into public.certification_review_operations values(p_idempotency_key,p_submission_id,p_expected_revision,decision,reason,p_actor,p_allowlist,result,now());
  return result;
end $$;

create function public.approve_telegram_certification(
  p_chat_id text,p_callback_token text,p_action_message_id bigint,p_telegram_user_id bigint,
  p_telegram_display_name text,p_telegram_username text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_certification_review_settings; d public.telegram_certification_deliveries; s public.certification_submissions; receipt public.telegram_certification_review_receipts; result jsonb;
  display_name text:=btrim(coalesce(p_telegram_display_name,'')); username text:=nullif(btrim(coalesce(p_telegram_username,'')),''); error_code text;
begin
  if p_callback_token is null or p_callback_token !~ '^[0-9a-f]{32}$' or p_action_message_id is null or p_action_message_id<=0
    or p_telegram_user_id is null or p_telegram_user_id<=0 or length(display_name) not between 1 and 128
    or (username is not null and username !~ '^[A-Za-z0-9_]{5,32}$') then
    return jsonb_build_object('outcome','error','error_code','TELEGRAM_CERTIFICATION_CALLBACK_INVALID');
  end if;
  select * into strict cfg from public.telegram_certification_review_settings where singleton;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id then return jsonb_build_object('outcome','error','error_code','TELEGRAM_CERTIFICATION_CHAT_INVALID'); end if;
  select * into d from public.telegram_certification_deliveries where callback_token=decode(p_callback_token,'hex') for update;
  if not found or d.chat_id is distinct from p_chat_id or d.action_message_id is distinct from p_action_message_id or d.status<>'sent' then
    return jsonb_build_object('outcome','error','error_code','TELEGRAM_CERTIFICATION_CALLBACK_MISMATCH');
  end if;
  select * into receipt from public.telegram_certification_review_receipts where delivery_id=d.id;
  if found then return jsonb_build_object('outcome','already_processed','status',receipt.final_status,'submission_id',receipt.submission_id); end if;
  select * into strict s from public.certification_submissions where id=d.submission_id;
  if s.status='pending' and s.review_revision<>d.expected_review_revision then
    return jsonb_build_object('outcome','error','error_code','CERTIFICATION_STALE_REVISION');
  end if;
  if s.status<>'pending' then
    insert into public.telegram_certification_review_receipts(delivery_id,submission_id,telegram_user_id,telegram_display_name,telegram_username,action_message_id,outcome,final_status)
      values(d.id,s.id,p_telegram_user_id,display_name,username,p_action_message_id,'already_processed',s.status);
    insert into public.audit_logs(action,entity_type,entity_id,correlation_id,before_after_summary)
      values('certification.submission.telegram_already_processed','certification_submission',s.id::text,extensions.gen_random_uuid(),
        jsonb_build_object('revision',s.review_revision,'reviewSource',s.review_source,'telegram',jsonb_build_object('userId',p_telegram_user_id,'displayName',display_name,'username',username),
          'reward',jsonb_build_object('scorePoints',s.reward_score_points,'ticketAmount',s.reward_ticket_amount,'stampCount',case when s.membership_platform is null then 0 else 1 end)));
    return jsonb_build_object('outcome','already_processed','status',s.status,'submission_id',s.id);
  end if;
  begin
    result:=public.finalize_certification_review_internal(s.id,d.expected_review_revision,'approved',null,'telegram',null,null,
      p_telegram_user_id,display_name,username,extensions.gen_random_uuid());
  exception when others then
    error_code:=case when sqlerrm in ('CERTIFICATION_STALE_REVISION','CERTIFICATION_ALREADY_APPROVED','CERTIFICATION_PASSPORT_REQUIRED','CERTIFICATION_MEMBERSHIP_WALLET_NOT_READY') then sqlerrm else 'TELEGRAM_CERTIFICATION_APPROVAL_FAILED' end;
    if error_code in ('CERTIFICATION_STALE_REVISION','CERTIFICATION_ALREADY_APPROVED') then
      select * into strict s from public.certification_submissions where id=d.submission_id;
      if s.status='pending' then
        return jsonb_build_object('outcome','error','error_code',error_code);
      end if;
      insert into public.telegram_certification_review_receipts(delivery_id,submission_id,telegram_user_id,telegram_display_name,telegram_username,action_message_id,outcome,final_status)
        values(d.id,s.id,p_telegram_user_id,display_name,username,p_action_message_id,'already_processed',s.status)
        on conflict(delivery_id) do nothing;
      insert into public.audit_logs(action,entity_type,entity_id,correlation_id,before_after_summary)
        values('certification.submission.telegram_already_processed','certification_submission',s.id::text,extensions.gen_random_uuid(),
          jsonb_build_object('revision',s.review_revision,'reviewSource',s.review_source,
            'telegram',jsonb_build_object('userId',p_telegram_user_id,'displayName',display_name,'username',username),
            'reward',jsonb_build_object('scorePoints',s.reward_score_points,'ticketAmount',s.reward_ticket_amount,
              'stampCount',case when s.membership_platform is null then 0 else 1 end)));
      return jsonb_build_object('outcome','already_processed','status',s.status,'submission_id',s.id);
    end if;
    return jsonb_build_object('outcome','error','error_code',error_code);
  end;
  insert into public.telegram_certification_review_receipts(delivery_id,submission_id,telegram_user_id,telegram_display_name,telegram_username,action_message_id,outcome,final_status)
    values(d.id,s.id,p_telegram_user_id,display_name,username,p_action_message_id,'approved','approved');
  return jsonb_build_object('outcome','approved','status','approved','submission_id',s.id,'revision',result->'revision');
end $$;

create function public.telegram_certification_review_health() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('enabled',cfg.enabled,'chat_id',cfg.chat_id,'activated_at',cfg.activated_at,
    'next_send_at',cfg.next_send_at,'lease_expires_at',cfg.lease_expires_at,
    'pending',count(*) filter(where d.status='pending'),'claimed',count(*) filter(where d.status='claimed'),
    'sending',count(*) filter(where d.status='sending'),'sent',count(*) filter(where d.status='sent'),
    'partial',count(*) filter(where d.status='partial'),'failed',count(*) filter(where d.status='failed'),
    'delivery_unknown',count(*) filter(where d.status='delivery_unknown'),'skipped',count(*) filter(where d.status='skipped'))
  from public.telegram_certification_review_settings cfg left join public.telegram_certification_deliveries d on true
  where cfg.singleton group by cfg.enabled,cfg.chat_id,cfg.activated_at,cfg.next_send_at,cfg.lease_expires_at;
$$;

revoke all on function public.configure_telegram_certification_reviews(text,boolean),
  public.claim_telegram_certification_delivery(text),
  public.record_telegram_certification_delivery(uuid,text,text,text,uuid,integer,bigint,integer,text),
  public.approve_telegram_certification(text,text,bigint,bigint,text,text),
  public.telegram_certification_review_health(),
  public.maintain_telegram_certification_reviews(),
  public.finalize_certification_review_internal(uuid,bigint,public.certification_submission_status,text,public.certification_review_source,uuid,uuid,bigint,text,text,uuid),
  public.capture_telegram_certification_submission() from public,anon,authenticated,service_role;
grant execute on function public.configure_telegram_certification_reviews(text,boolean),
  public.claim_telegram_certification_delivery(text),
  public.record_telegram_certification_delivery(uuid,text,text,text,uuid,integer,bigint,integer,text),
  public.approve_telegram_certification(text,text,bigint,bigint,text,text),
  public.telegram_certification_review_health() to service_role;

select cron.schedule(
  'telegram-certification-review-maintenance',
  '*/5 * * * *',
  'select public.maintain_telegram_certification_reviews()'
);
