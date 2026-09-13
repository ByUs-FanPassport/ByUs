\set ON_ERROR_STOP on
-- Required psql variables: -v from=<ISO8601> -v to=<ISO8601>.
-- Aggregate output only; never emit IDs, source keys, tokens, destinations or payloads.
-- Window counts use [from,to); mutable states and integrity are current snapshots.
begin transaction isolation level repeatable read read only;
set local statement_timeout='30s';
select 1 / case when :'from'::timestamptz < :'to'::timestamptz
  and :'to'::timestamptz <= statement_timestamp()
  and :'to'::timestamptz - :'from'::timestamptz <= interval '7 days'
  then 1 else 0 end as valid_window \gset
with p as (
  select :'from'::timestamptz f, :'to'::timestamptz t, statement_timestamp() checked_at
), owners as (
  select a.id, exists(select 1 from public.admin_allowlist x
    where x.active and x.email=a.verified_email) as admin_allowlisted
  from public.app_users a
), stamps as (
  select s.*,o.admin_allowlisted from public.community_stamps s join owners o on o.id=s.app_user_id
), stamp_window as (
  select kind,mint_status,admin_allowlisted,count(*) rows,count(distinct app_user_id) owners,
    max(issued_at) latest_issued_at
  from stamps,p where issued_at>=p.f and issued_at<p.t group by 1,2,3
), jobs as (
  select s.*,j.status as job_status,j.entity_type,j.entity_id,j.tx_hash as job_tx_hash,
    j.token_id as job_token_id,j.next_attempt_at,j.updated_at,j.lease_expires_at
  from stamps s left join public.blockchain_jobs j on j.id=s.blockchain_job_id
), stamp_integrity as (
  select count(*) filter(where entity_type is distinct from 'community_stamp' or entity_id is distinct from id) identity_mismatch,
    count(*) filter(where mint_status::text is distinct from case job_status
      when 'PENDING' then 'queued' when 'PROCESSING' then 'processing' when 'RETRYING' then 'retryable'
      when 'FAILED' then 'permanent_failure' when 'COMPLETED' then 'minted' end) status_mismatch,
    count(*) filter(where job_status='COMPLETED' and
      (tx_hash is distinct from job_tx_hash or token_id is distinct from job_token_id)) mint_result_mismatch,
    count(*) filter(where job_status='FAILED') failed_jobs,
    count(*) filter(where job_status in ('PENDING','RETRYING') and next_attempt_at < p.checked_at-interval '30 minutes') due_over_30m,
    count(*) filter(where job_status='PROCESSING' and lease_expires_at<p.checked_at) expired_processing_leases
  from jobs,p
), share_integrity as (
  select
    (select count(*) from public.community_stamp_share_visits v join public.community_stamp_share_links l on l.id=v.share_link_id
      where v.visitor_app_user_id=l.owner_app_user_id) self_visits,
    (select count(*) from public.community_stamp_share_links l
      where exists(select 1 from public.community_stamp_share_visits v where v.share_link_id=l.id)
      and not exists(select 1 from stamps s where s.kind='share' and s.app_user_id=l.owner_app_user_id and s.celebrity_id=l.celebrity_id)) visited_links_without_stamp,
    (select count(*) from stamps s where s.kind='share' and not exists(
      select 1 from public.community_stamp_share_visits v join public.community_stamp_share_links l on l.id=v.share_link_id
      where s.source_key='verified-share-visit:'||v.id::text and s.app_user_id=l.owner_app_user_id
      and s.celebrity_id=l.celebrity_id and v.visitor_app_user_id<>l.owner_app_user_id)) stamps_without_visit
), invite_integrity as (
  -- Invite stamp is account-once, not two NEW stamps for every redemption.
  select count(*) filter(where r.inviter_app_user_id=r.invitee_app_user_id) self_invites,
    count(*) filter(where not exists(select 1 from stamps s where s.kind='invite' and s.app_user_id=r.inviter_app_user_id)
      or not exists(select 1 from stamps s where s.kind='invite' and s.app_user_id=r.invitee_app_user_id)) redemptions_missing_owner_stamp
  from public.community_stamp_invite_redemptions r
), delivery_snapshot as (
  select d.channel,d.status,n.kind,
    public.fan_notification_is_released(d.notification_id,d.channel) released,
    count(*) rows,
    count(*) filter(where d.available_at<=p.checked_at and n.scheduled_for<=p.checked_at) schedule_elapsed_rows,
    count(*) filter(where d.status='processing' and d.lease_expires_at<p.checked_at) expired_leases
  from public.external_notification_delivery_outbox d join public.fan_notifications n on n.id=d.notification_id cross join p
  group by 1,2,3,4
), attempt_window as (
  select 'email' as channel,status,count(*) rows from public.email_notification_send_attempts,p
    where started_at>=p.f and started_at<p.t group by status
  union all
  select 'kakao',status,count(*) from public.kakao_notification_attempts,p
    where created_at>=p.f and created_at<p.t group by status
), sms_window as (
  select send_status,count(*) retained_rows,
    count(*) filter(where verified_at is not null) verified,
    count(*) filter(where consumed_at is not null) consumed,
    count(*) filter(where cancelled_at is not null) cancelled,
    count(*) filter(where failed_attempts>0) incorrect_code_challenges
  from public.phone_sms_verification_challenges,p where created_at>=p.f and created_at<p.t group by 1
), instagram_connections as (
  select c.*, (connected_at is not null and token_ciphertext is not null
    and ig_user_id is not null and identity is not null) as connected
  from public.instagram_connections c
), channel_snapshot as (
  select kind,status,verification_method,count(*) rows,
    count(*) filter(where consented_at is not null and consent_revoked_at is null) consented
  from public.fan_notification_channels group by 1,2,3
)
select jsonb_build_object(
  'schemaVersion',1,'from',p.f,'to',p.t,'snapshotAt',p.checked_at,
  'transactionReadOnly',current_setting('transaction_read_only'),
  'population','all owners; only stamp window separates current active admin allowlist; non-admin is not proven organic',
  'activityWindow',jsonb_build_object(
    'stamps',coalesce((select jsonb_agg(s order by kind,mint_status,admin_allowlisted) from stamp_window s),'[]'),
    'shareLinksCreated',(select count(*) from public.community_stamp_share_links where created_at>=p.f and created_at<p.t),
    'shareVisits',(select count(*) from public.community_stamp_share_visits where visited_at>=p.f and visited_at<p.t),
    'inviteRedemptions',(select count(*) from public.community_stamp_invite_redemptions where redeemed_at>=p.f and redeemed_at<p.t)),
  'currentIntegrity',jsonb_build_object('stamps',(select to_jsonb(s) from stamp_integrity s),
    'share',(select to_jsonb(s) from share_integrity s),'invite',(select to_jsonb(s) from invite_integrity s)),
  'notificationSnapshot',jsonb_build_object(
    'controls',(select jsonb_agg(jsonb_build_object('channel',channel,'mode',mode,'activatedAt',activated_at,
      'allowedKinds',allowed_kinds,'testUserCount',cardinality(test_user_ids)) order by channel) from public.fan_notification_delivery_control),
    'deliveries',coalesce((select jsonb_agg(d order by channel,status,kind,released) from delivery_snapshot d),'[]'),
    'channels',coalesce((select jsonb_agg(c order by kind,status,verification_method) from channel_snapshot c),'[]')),
  'sendAttemptWindow',coalesce((select jsonb_agg(a order by channel,status) from attempt_window a),'[]'),
  'smsRetainedWindow',coalesce((select jsonb_agg(s order by send_status) from sms_window s),'[]'),
  'smsRetentionWarning','Retained challenges are not a complete historical funnel; consumed does not prove current eligible enrollment or SMS receipt.',
  'instagramSnapshot',(select jsonb_build_object('slots',count(*),'connections',count(*) filter(where connected),'liveOptIn',count(*) filter(where connected and live_enabled),
    'usableTokens',count(*) filter(where connected and token_expires_at>p.checked_at),
    'expiredTokens',count(*) filter(where connected and token_expires_at<=p.checked_at),
    'storedErrors',count(*) filter(where connected and last_error is not null),
    'mediaNeverFetched',count(*) filter(where connected and media_fetched_at is null),
    'mediaLatestFetchedAt',max(media_fetched_at) filter(where connected),
    'liveObservationPresent',count(*) filter(where connected and live_enabled and live_observation is not null)) from instagram_connections),
  'externalEvidence',jsonb_build_object('workerRuntime','requires separate read-only AWS evidence',
    'platformWatchResolution','requires existing sanitized request/cache evidence; no synthetic watch request',
    'receipt','provider acceptance, queue completion and actual receipt must be distinguished',
    'attribution','new activity-to-login attribution is not collected; do not join anonymous and account identities')
) from p;
rollback;
