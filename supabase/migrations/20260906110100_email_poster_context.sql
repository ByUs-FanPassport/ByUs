-- Add published visual context to SES email payloads; preserve claim/consent behavior.
-- Claim only email deliveries while Kakao provider approval is pending.
-- Keep the original RPC unchanged for existing workers and test sinks.
create or replace function public.claim_email_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if length(trim(p_worker_id)) not between 3 and 120 or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID';end if;
 return query with due as(select o.id from public.external_notification_delivery_outbox o where o.channel='email' and exists(select 1 from public.fan_notification_channels ch join public.app_users u on u.id=ch.app_user_id where ch.id=o.channel_id and ch.kind='email' and ch.status='eligible' and ch.consented_at is not null and ch.consent_revoked_at is null and ch.verified_at is not null and u.status='active') and o.attempt_count<8 and o.available_at<=p_now and(o.status='pending' or o.status='failed' or(o.status='processing' and o.lease_expires_at<=p_now)) order by o.available_at,o.id for update skip locked limit p_batch_size),claimed as(update public.external_notification_delivery_outbox o set status='processing',attempt_count=o.attempt_count+1,lease_owner=p_worker_id,lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),last_error_code=null,updated_at=p_now from due where o.id=due.id returning o.*)
 select c.id,c.notification_id,c.plan_id,c.channel,c.sequence,c.template_key,c.locale,p.destination,
   jsonb_build_object('title',coalesce(n.payload->>'title','ByUs'),'detail',coalesce(n.payload->>'detail','새 소식을 확인해 주세요.'),'deepLink',coalesce(n.deep_link,'/my'),'context',jsonb_strip_nulls(jsonb_build_object('title',coalesce(ll.title,bl.title),'imageUrl',coalesce(preview.landscape_poster_url,live.approved_hero_url,artist.image_url),'startsAt',live.starts_at))),
   c.attempt_count,c.lease_owner,c.lease_expires_at from claimed c join public.fan_notification_channel_private p on p.channel_id=c.channel_id join public.fan_notifications n on n.id=c.notification_id
 left join public.live_events live on live.id=n.live_event_id and live.publication_status='published' and live.archived_at is null
 left join public.benefits benefit on benefit.id=n.benefit_id and benefit.publication_status='published'
 left join public.celebrities artist on artist.id=benefit.celebrity_id and artist.status='published'
 left join public.live_event_previews preview on preview.live_event_id=live.id and preview.publication_status='published' and preview.archived_at is null
 left join lateral(select loc.title from public.live_event_localizations loc where loc.live_event_id=live.id order by (loc.locale::text=c.locale) desc,(loc.locale::text='ko') desc limit 1) ll on true
 left join lateral(select loc.title from public.benefit_localizations loc where loc.benefit_id=benefit.id order by (loc.locale::text=c.locale) desc,(loc.locale::text='ko') desc limit 1) bl on true;
end $$;

revoke all on function public.claim_email_notification_deliveries(text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_email_notification_deliveries(text,integer,integer,timestamptz) to service_role;
