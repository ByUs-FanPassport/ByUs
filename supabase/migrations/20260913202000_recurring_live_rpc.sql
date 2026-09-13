-- Official-source import, explicit approval, generation, review, and coverage.
-- These are service-role APIs; raw evidence tables remain private.

create function public.is_valid_recurring_live_channel_url(p_provider text,p_url text)
returns boolean language sql immutable set search_path='' as $$
  select p_provider in('youtube','instagram','tiktok','chzzk') and p_url=pg_catalog.btrim(p_url)
    and length(p_url) between 8 and 2048 and p_url !~ '[[:space:]]'
    and p_url !~ '^https://[^/]*@' -- credentials in the authority component
    and case p_provider
      when 'youtube' then p_url ~ '^https://(?:www\.)?youtube\.com/(?:@?[A-Za-z0-9_.-]+(?:/live)?|channel/[A-Za-z0-9_-]+|watch\?[^#[:space:]]+|live/[A-Za-z0-9_-]+)(?:\?[^#[:space:]]*)?$'
        or p_url ~ '^https://youtu\.be/[A-Za-z0-9_-]+(?:\?[^#[:space:]]*)?$'
      when 'instagram' then p_url ~ '^https://(?:www\.)?instagram\.com/[^#[:space:]]+$'
      when 'tiktok' then p_url ~ '^https://(?:www\.)?tiktok\.com/[^#[:space:]]+$'
      when 'chzzk' then p_url ~ '^https://chzzk\.naver\.com/(?:live/)?[0-9a-f]{32}/?$'
      else false end
$$;

create or replace function public.is_valid_external_live_url(p_provider public.social_platform,p_url text)
returns boolean language sql immutable set search_path='' as $$
  select p_url=pg_catalog.btrim(p_url) and p_url !~ '[#[:space:]]'
    and case p_provider
      when 'youtube'::public.social_platform then
        (p_url ~ '^https://(?:www\.)?youtube\.com/watch\?[^#[:space:]]+$'
          and ('&'||pg_catalog.split_part(p_url,'?',2)||'&') ~ '&v=[A-Za-z0-9_-]+&')
        or p_url ~ '^https://(?:www\.)?youtube\.com/(?:live|embed)/[A-Za-z0-9_-]+(?:\?[^#[:space:]]*)?$'
        or p_url ~ '^https://youtu\.be/[A-Za-z0-9_-]+(?:\?[^#[:space:]]*)?$'
      when 'instagram'::public.social_platform then p_url ~ '^https://(?:www\.)?instagram\.com/[^#[:space:]]*$'
      when 'tiktok'::public.social_platform then p_url ~ '^https://(?:www\.)?tiktok\.com/[^#[:space:]]*$'
      when 'chzzk'::public.social_platform then p_url ~ '^https://chzzk\.naver\.com/(?:live/)?[0-9a-f]{32}/?$'
      else false end
$$;

alter table public.live_events drop constraint live_events_external_live_url_allowlist;
alter table public.live_events add constraint live_events_external_live_url_allowlist check (
  youtube_url=external_live_url and case when live_type='recurring'
    then public.is_valid_recurring_live_channel_url(live_provider::text,external_live_url)
    else public.is_valid_external_live_url(live_provider,external_live_url) end
);

create function public.is_valid_recurring_live_rule(p_rule jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare slot jsonb; slot_count integer; timezone_name text;
begin
  if jsonb_typeof(p_rule)<>'object' or (select count(*) from jsonb_object_keys(p_rule))<>6
    or not (p_rule ?& array['timeZone','effectiveFrom','effectiveUntil','provider','channelUrl','slots'])
    or (p_rule->>'timeZone') is null or length(p_rule->>'timeZone')>100
    or (p_rule->>'provider') not in('youtube','instagram','tiktok','chzzk')
    or not public.is_valid_recurring_live_channel_url(p_rule->>'provider',p_rule->>'channelUrl')
    or jsonb_typeof(p_rule->'slots')<>'array' then return false; end if;
  begin
    perform (p_rule->>'effectiveFrom')::date;
    if p_rule->'effectiveUntil'<>'null'::jsonb and (p_rule->>'effectiveUntil')::date<(p_rule->>'effectiveFrom')::date then return false; end if;
  exception when others then return false; end;
  select name into timezone_name from pg_catalog.pg_timezone_names where name=p_rule->>'timeZone';
  if timezone_name is null then return false; end if;
  slot_count:=jsonb_array_length(p_rule->'slots');
  if slot_count not between 1 and 14 then return false; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_rule->'slots'))<>slot_count then return false; end if;
  for slot in select value from jsonb_array_elements(p_rule->'slots') loop
    if jsonb_typeof(slot)<>'object' or (select count(*) from jsonb_object_keys(slot))<>4
      or not (slot ?& array['id','isoWeekday','localStartTime','end']) then return false; end if;
    begin perform (slot->>'id')::uuid; exception when others then return false; end;
    if (slot->>'isoWeekday')::integer not between 1 and 7
      or (slot->>'localStartTime') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    if slot->'end'<>'null'::jsonb and (
      jsonb_typeof(slot->'end')<>'object' or (select count(*) from jsonb_object_keys(slot->'end'))<>2
      or not (slot->'end' ?& array['localTime','dayOffset'])
      or slot->'end'->>'localTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or (slot->'end'->>'dayOffset')::integer not between 0 and 2) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function public.recurring_live_local_instant(p_date date,p_local_time text,p_time_zone text)
returns timestamptz language plpgsql stable set search_path='' as $$
declare local_value timestamp; candidate timestamptz;
begin
  local_value:=p_date+p_local_time::time;
  candidate:=local_value at time zone p_time_zone;
  if candidate at time zone p_time_zone<>local_value
    or (candidate-interval '1 hour') at time zone p_time_zone=local_value
    or (candidate+interval '1 hour') at time zone p_time_zone=local_value then return null; end if;
  return candidate;
exception when others then return null;
end $$;

create function public.get_admin_recurring_live_schedules(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select jsonb_build_object(
    'runs',coalesce((select jsonb_agg(jsonb_build_object('id',run.id,'mode',run.mode,'status',run.status,
      'inputHash',run.input_hash,'startedAt',run.started_at,'completedAt',run.completed_at,'summary',run.summary)
      order by run.started_at desc,run.id desc) from (select * from public.recurring_live_runs order by started_at desc,id desc limit 50) run),'[]'::jsonb),
    'series',coalesce((select jsonb_agg(jsonb_build_object('id',series.id,'celebrityId',series.celebrity_id,
      'celebritySlug',celebrity.slug,'celebrityName',ko.name,'status',series.status,
      'currentRuleRevisionId',series.current_rule_revision_id,'rule',revision.rule,'lastObservedAt',observation.observed_at)
      order by celebrity.display_order,series.id)
      from public.recurring_live_series series join public.celebrities celebrity on celebrity.id=series.celebrity_id
      join public.celebrity_localizations ko on ko.celebrity_id=celebrity.id and ko.locale='ko'
      left join public.recurring_live_rule_revisions revision on revision.id=series.current_rule_revision_id
      left join lateral(select item.observed_at from public.recurring_live_observations item
        where item.celebrity_id=series.celebrity_id order by item.observed_at desc,item.id desc limit 1) observation on true),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',revision.id,'seriesId',revision.series_id,
      'celebrityName',ko.name,'revision',revision.revision,'reason',revision.reason,'rule',revision.rule,
      'currentRule',current_revision.rule,'expectedCurrentRevisionId',series.current_rule_revision_id,
      'observations',coalesce((select jsonb_agg(jsonb_build_object('sourceUrl',observation.source_url,
        'originalText',observation.original_text,'observedAt',observation.observed_at) order by observation.observed_at,observation.id)
        from public.recurring_live_observations observation where observation.id=any(revision.source_observation_ids)),'[]'::jsonb),
      'reviewPayload',revision.review_payload||jsonb_build_object('runId',revision.review_payload->'runId','candidateEvents',
        coalesce((select jsonb_agg(jsonb_build_object('id',live.id,'slug',live.slug,'startsAt',live.starts_at,
          'title',localization.title,'reservationCount',(select count(*) from public.live_reservations reservation where reservation.live_event_id=live.id))
          order by live.starts_at,live.id)
          from jsonb_array_elements_text(coalesce(revision.review_payload->'candidateEventIds','[]'::jsonb)) candidate(id)
          join public.live_events live on live.id=candidate.id::uuid
          left join public.live_event_localizations localization on localization.live_event_id=live.id and localization.locale='ko'),'[]'::jsonb)))
      order by revision.created_at,revision.id)
      from public.recurring_live_rule_revisions revision
      join public.recurring_live_series series on series.id=revision.series_id
      join public.celebrities celebrity on celebrity.id=series.celebrity_id
      join public.celebrity_localizations ko on ko.celebrity_id=celebrity.id and ko.locale='ko'
      left join public.recurring_live_rule_revisions current_revision on current_revision.id=series.current_rule_revision_id
      where revision.status='proposed'),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.resolve_admin_recurring_live_review(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_revision_id uuid,
  p_expected_current_revision_id uuid,p_resolution jsonb,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare proposed public.recurring_live_rule_revisions%rowtype; series_record public.recurring_live_series%rowtype;
  event_record public.live_events%rowtype; slot jsonb; target_start timestamptz; target_end timestamptz; action text;
  selected_ids uuid[]; selected_id uuid; creator_id uuid; event_local_date date;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or jsonb_typeof(p_resolution)<>'object' or not (p_resolution ? 'action') then
    raise exception 'RECURRING_LIVE_RESOLUTION_INVALID'; end if;
  action:=p_resolution->>'action';
  if action not in('approve_rule','reject','link_existing','distinct_events','cancel_occurrences')
    or (action in('reject','cancel_occurrences') and length(pg_catalog.btrim(coalesce(p_resolution->>'reason',''))) not between 1 and 1000) then
    raise exception 'RECURRING_LIVE_RESOLUTION_INVALID'; end if;
  select series.celebrity_id into strict creator_id from public.recurring_live_rule_revisions revision
    join public.recurring_live_series series on series.id=revision.series_id where revision.id=p_revision_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||creator_id::text,0));
  select * into strict proposed from public.recurring_live_rule_revisions where id=p_revision_id for update;
  select * into strict series_record from public.recurring_live_series where id=proposed.series_id for update;
  if proposed.status<>'proposed' then raise exception 'RECURRING_LIVE_REVIEW_ALREADY_RESOLVED'; end if;
  if series_record.current_rule_revision_id is distinct from p_expected_current_revision_id then
    raise exception 'RECURRING_LIVE_RULE_CAS_CONFLICT'; end if;
  if action='reject' then
    update public.recurring_live_rule_revisions set status='rejected',review_payload=review_payload||jsonb_build_object(
      'resolution','reject','reason',pg_catalog.btrim(p_resolution->>'reason'),'resolvedAt',pg_catalog.clock_timestamp()) where id=proposed.id;
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'recurring_live.rule.rejected','recurring_live_rule_revision',proposed.id::text,
      jsonb_build_object('seriesId',series_record.id,'reason',pg_catalog.btrim(p_resolution->>'reason')),p_correlation_id);
    return jsonb_build_object('revisionId',proposed.id,'status','rejected','resolution','reject','seriesId',series_record.id,
      'currentRuleRevisionId',series_record.current_rule_revision_id);
  end if;
  if action='link_existing' then
    if proposed.reason<>'duplicate' or (p_resolution->>'eventId')::uuid is null
      or not (proposed.review_payload->'candidateEventIds' @> jsonb_build_array(p_resolution->'eventId')) then
      raise exception 'RECURRING_LIVE_LINK_INVALID'; end if;
    select * into strict event_record from public.live_events where id=(p_resolution->>'eventId')::uuid for update;
    if event_record.celebrity_id<>series_record.celebrity_id or event_record.live_type<>'general'
      or event_record.publication_status<>'published' or event_record.archived_at is not null
      or event_record.starts_at is distinct from (proposed.review_payload->>'startsAt')::timestamptz
      or event_record.live_provider::text<>proposed.review_payload->>'provider'
      or pg_catalog.btrim(event_record.external_live_url)<>pg_catalog.btrim(proposed.review_payload->>'channelUrl') then
      raise exception 'RECURRING_LIVE_LINK_INVALID'; end if;
    perform pg_catalog.set_config('byus.recurring_live_writer','on',true);
    update public.live_events set live_type='recurring',recurring_series_id=series_record.id,
      recurring_slot_id=(proposed.review_payload->>'slotId')::uuid,recurrence_week=(proposed.review_payload->>'recurrenceWeek')::date,
      recurring_rule_revision_id=series_record.current_rule_revision_id where id=event_record.id;
    update public.recurring_live_rule_revisions set status='rejected',review_payload=review_payload||jsonb_build_object(
      'resolution','link_existing','linkedEventId',event_record.id) where id=proposed.id;
  elsif action='distinct_events' then
    if proposed.reason<>'duplicate' then raise exception 'RECURRING_LIVE_DISTINCT_INVALID'; end if;
    update public.recurring_live_rule_revisions set status='rejected',review_payload=review_payload||jsonb_build_object(
      'resolution','distinct_events') where id=proposed.id;
  elsif action='cancel_occurrences' then
    if proposed.reason not in('hiatus','source_conflict') or jsonb_typeof(p_resolution->'eventIds')<>'array'
      or jsonb_array_length(p_resolution->'eventIds')>100
      or (jsonb_array_length(p_resolution->'eventIds')=0 and proposed.reason<>'hiatus') then
      raise exception 'RECURRING_LIVE_CANCEL_INVALID'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into selected_ids from jsonb_array_elements_text(p_resolution->'eventIds');
    if cardinality(selected_ids)<>cardinality(array(select distinct unnest(selected_ids)))
      or exists(select 1 from unnest(selected_ids) item(id) left join public.live_events live on live.id=item.id
        where live.id is null or live.recurring_series_id is distinct from series_record.id
          or live.celebrity_id is distinct from series_record.celebrity_id or live.archived_at is not null
          or live.publication_status<>'published' or live.starts_at<=pg_catalog.statement_timestamp()
          or not (proposed.review_payload->'candidateEventIds' @> jsonb_build_array(to_jsonb(item.id)))) then
      raise exception 'RECURRING_LIVE_CANCEL_INVALID'; end if;
    foreach selected_id in array selected_ids loop
      perform public.create_admin_live_status_override(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,
        selected_id,'cancelled',pg_catalog.statement_timestamp(),null,pg_catalog.btrim(p_resolution->>'reason'));
    end loop;
    update public.recurring_live_rule_revisions set status='rejected',review_payload=review_payload||jsonb_build_object(
      'resolution','cancel_occurrences','cancelledEventIds',to_jsonb(selected_ids)) where id=proposed.id;
    if proposed.reason='hiatus' then
      update public.recurring_live_series set status='paused',updated_at=pg_catalog.clock_timestamp() where id=series_record.id;
    end if;
  end if;
  if action in('link_existing','distinct_events','cancel_occurrences') then
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'recurring_live.review.'||action,'recurring_live_rule_revision',proposed.id::text,
      jsonb_build_object('seriesId',series_record.id,'resolution',p_resolution),p_correlation_id);
    return jsonb_build_object('revisionId',proposed.id,'status','rejected','resolution',action,'seriesId',series_record.id,
      'currentRuleRevisionId',series_record.current_rule_revision_id);
  end if;
  if proposed.reason not in('initial','rule_change') or not public.is_valid_recurring_live_rule(proposed.rule) then
    raise exception 'RECURRING_LIVE_RULE_NOT_APPROVABLE'; end if;
  for event_record in select * from public.live_events where recurring_series_id=series_record.id
    and publication_status='published' and archived_at is null and starts_at>pg_catalog.statement_timestamp()
    order by recurrence_week,recurring_slot_id for update loop
    event_local_date:=(event_record.starts_at at time zone (proposed.rule->>'timeZone'))::date;
    if event_local_date<(proposed.rule->>'effectiveFrom')::date
      or (proposed.rule->'effectiveUntil'<>'null'::jsonb and event_local_date>(proposed.rule->>'effectiveUntil')::date) then
      continue;
    end if;
    select value into slot from jsonb_array_elements(proposed.rule->'slots') where (value->>'id')::uuid=event_record.recurring_slot_id;
    if slot is null then raise exception 'RECURRING_LIVE_RULE_REMOVES_PUBLISHED_SLOT'; end if;
    target_start:=public.recurring_live_local_instant(event_record.recurrence_week+((slot->>'isoWeekday')::integer-1),
      slot->>'localStartTime',proposed.rule->>'timeZone');
    target_end:=case when slot->'end'='null'::jsonb then null else public.recurring_live_local_instant(
      event_record.recurrence_week+((slot->>'isoWeekday')::integer-1)+(slot->'end'->>'dayOffset')::integer,
      slot->'end'->>'localTime',proposed.rule->>'timeZone') end;
    if target_start is null or (slot->'end'<>'null'::jsonb and target_end is null) then raise exception 'RECURRING_LIVE_DST_REVIEW_REQUIRED'; end if;
    if event_record.starts_at is distinct from target_start or event_record.ends_at is distinct from target_end then
      perform public.reschedule_admin_live(p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,event_record.id,
        event_record.schedule_revision,'Approved recurring LIVE rule change',event_record.reservation_opens_at,target_start,
        target_start,target_end,event_record.attendance_valid_from,event_record.attendance_valid_until);
    end if;
    perform pg_catalog.set_config('byus.recurring_live_writer','on',true);
    update public.live_events set recurring_rule_revision_id=proposed.id where id=event_record.id;
  end loop;
  update public.recurring_live_rule_revisions set status='approved',approved_actor_app_user_id=p_actor_app_user_id,
    approved_actor_admin_allowlist_id=p_actor_admin_allowlist_id,approved_at=pg_catalog.clock_timestamp(),
    review_payload=review_payload||jsonb_build_object('resolution','approve_rule') where id=proposed.id;
  update public.recurring_live_series set current_rule_revision_id=proposed.id,updated_at=pg_catalog.clock_timestamp() where id=series_record.id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'recurring_live.rule.approved','recurring_live_rule_revision',proposed.id::text,
    jsonb_build_object('seriesId',series_record.id,'previousRuleRevisionId',p_expected_current_revision_id),p_correlation_id);
  return jsonb_build_object('revisionId',proposed.id,'status','approved','resolution','approve_rule','seriesId',series_record.id,
    'currentRuleRevisionId',proposed.id);
end $$;

create function public.replenish_recurring_live_events(p_run_id uuid,p_horizon_days integer,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare series_record record; candidate_series record; slot jsonb; week_offset integer; occurrence_date date; recurrence_monday date;
  v_starts_at timestamptz; v_ends_at timestamptz; existing_id uuid; candidate_ids uuid[]; event_id uuid;
  created_ids uuid[]:='{}'; created_count integer:=0; reused_count integer:=0; unchanged_count integer:=0;
  review_count integer:=0; local_start_date date; local_horizon date; celebrity_record record; result jsonb;
  duplicate_hash text; next_revision integer; distinct_confirmed boolean;
begin
  if p_run_id is null or p_now is null or p_horizon_days not between 1 and 60 then
    raise exception 'RECURRING_LIVE_REPLENISH_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:replenish:'||p_run_id::text,0));
  select summary->'replenishResult' into result from public.recurring_live_runs where id=p_run_id;
  if result is not null then return result; end if;
  insert into public.recurring_live_runs(id,idempotency_key,input_hash,mode,status,roster)
  values(p_run_id,'replenish:'||p_run_id::text,
    encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object('runId',p_run_id,'days',p_horizon_days,'now',p_now)::text,'UTF8'),'sha256'),'hex'),
    'replenish','running',jsonb_build_object('observedAt',p_now))
  on conflict(id) do nothing;
  if not exists(select 1 from public.recurring_live_runs where id=p_run_id and mode='replenish') then
    raise exception 'RECURRING_LIVE_RUN_CONFLICT';
  end if;
  for candidate_series in
    select series.id,series.celebrity_id from public.recurring_live_series series
    join public.celebrities celebrity on celebrity.id=series.celebrity_id
      and celebrity.status='published' and celebrity.archived_at is null
    where series.status='active' order by series.celebrity_id,series.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||candidate_series.celebrity_id::text,0));
    select series.*,revision.rule,revision.id rule_revision_id into series_record
      from public.recurring_live_series series
      join public.recurring_live_rule_revisions revision on revision.id=series.current_rule_revision_id and revision.status='approved'
      join public.celebrities celebrity on celebrity.id=series.celebrity_id and celebrity.status='published' and celebrity.archived_at is null
      where series.id=candidate_series.id and series.status='active' for update of series;
    if not found then continue; end if;
    if exists(select 1 from public.recurring_live_rule_revisions proposed where proposed.series_id=series_record.id and proposed.status='proposed') then
      review_count:=review_count+1; continue;
    end if;
    select celebrity.slug,celebrity.image_url,ko.name ko_name,en.name en_name into strict celebrity_record
      from public.celebrities celebrity
      join public.celebrity_localizations ko on ko.celebrity_id=celebrity.id and ko.locale='ko'
      join public.celebrity_localizations en on en.celebrity_id=celebrity.id and en.locale='en'
      where celebrity.id=series_record.celebrity_id and celebrity.status='published' and celebrity.archived_at is null;
    local_start_date:=(p_now at time zone (series_record.rule->>'timeZone'))::date;
    local_horizon:=((p_now+pg_catalog.make_interval(days=>p_horizon_days)) at time zone (series_record.rule->>'timeZone'))::date;
    for slot in select value from jsonb_array_elements(series_record.rule->'slots') loop
      for week_offset in 0..((p_horizon_days/7)+2) loop
        recurrence_monday:=date_trunc('week',local_start_date::timestamp)::date+(week_offset*7);
        occurrence_date:=recurrence_monday+((slot->>'isoWeekday')::integer-1);
        if occurrence_date<local_start_date or occurrence_date>local_horizon
          or occurrence_date<(series_record.rule->>'effectiveFrom')::date
          or (series_record.rule->'effectiveUntil'<>'null'::jsonb and occurrence_date>(series_record.rule->>'effectiveUntil')::date) then continue; end if;
        v_starts_at:=public.recurring_live_local_instant(occurrence_date,slot->>'localStartTime',series_record.rule->>'timeZone');
        if v_starts_at is null then review_count:=review_count+1; continue; end if;
        if v_starts_at<=p_now or v_starts_at>p_now+pg_catalog.make_interval(days=>p_horizon_days) then continue; end if;
        v_ends_at:=case when slot->'end'='null'::jsonb then null else public.recurring_live_local_instant(
          occurrence_date+(slot->'end'->>'dayOffset')::integer,slot->'end'->>'localTime',series_record.rule->>'timeZone') end;
        if slot->'end'<>'null'::jsonb and (v_ends_at is null or v_ends_at<=v_starts_at) then review_count:=review_count+1; continue; end if;
        select id into existing_id from public.live_events live where live.recurring_series_id=series_record.id
          and live.recurring_slot_id=(slot->>'id')::uuid and live.recurrence_week=recurrence_monday;
        if existing_id is not null then unchanged_count:=unchanged_count+1; continue; end if;
        select array_agg(live.id order by live.id) into candidate_ids from public.live_events live
          where live.celebrity_id=series_record.celebrity_id and live.archived_at is null
            and (live.starts_at at time zone (series_record.rule->>'timeZone'))::date=occurrence_date
            and (live.live_type='general' or live.recurring_series_id is distinct from series_record.id);
        if cardinality(candidate_ids)=1 and exists(select 1 from public.live_events live where live.id=candidate_ids[1]
          and live.live_type='general' and live.publication_status='published' and live.starts_at=v_starts_at
          and live.live_provider::text=series_record.rule->>'provider'
          and pg_catalog.btrim(live.external_live_url)=pg_catalog.btrim(series_record.rule->>'channelUrl')) then
          perform pg_catalog.set_config('byus.recurring_live_writer','on',true);
          update public.live_events set live_type='recurring',recurring_series_id=series_record.id,
            recurring_slot_id=(slot->>'id')::uuid,recurrence_week=recurrence_monday,
            recurring_rule_revision_id=series_record.rule_revision_id where id=candidate_ids[1];
          reused_count:=reused_count+1; continue;
        elsif cardinality(candidate_ids)>0 then
          select exists(select 1 from public.recurring_live_rule_revisions resolved
            where resolved.series_id=series_record.id and resolved.reason='duplicate' and resolved.status='rejected'
              and resolved.review_payload->>'resolution'='distinct_events'
              and resolved.review_payload->>'recurrenceWeek'=recurrence_monday::text
              and resolved.review_payload->>'slotId'=slot->>'id') into distinct_confirmed;
          if not distinct_confirmed then
            duplicate_hash:=encode(extensions.digest(pg_catalog.convert_to(series_record.rule::text||':duplicate:'||recurrence_monday::text||':'||(slot->>'id'),'UTF8'),'sha256'),'hex');
            if not exists(select 1 from public.recurring_live_rule_revisions item where item.series_id=series_record.id
              and item.status='proposed' and item.proposal_hash=duplicate_hash) then
              select coalesce(max(item.revision),0)+1 into next_revision from public.recurring_live_rule_revisions item where item.series_id=series_record.id;
              insert into public.recurring_live_rule_revisions(series_id,revision,rule,source_observation_ids,proposal_hash,reason,review_payload)
              select series_record.id,next_revision,series_record.rule,current.source_observation_ids,duplicate_hash,'duplicate',
                jsonb_build_object('runId',p_run_id,'candidateEventIds',to_jsonb(candidate_ids),'recurrenceWeek',recurrence_monday,
                  'slotId',slot->>'id','startsAt',v_starts_at,'provider',series_record.rule->>'provider','channelUrl',series_record.rule->>'channelUrl')
              from public.recurring_live_rule_revisions current where current.id=series_record.rule_revision_id;
            end if;
            review_count:=review_count+1; continue;
          end if;
        end if;
        event_id:=extensions.gen_random_uuid();
        perform pg_catalog.set_config('byus.recurring_live_writer','on',true);
        insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,
          reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,
          live_provider,external_live_url,ever_published_at,live_type,recurring_series_id,recurring_slot_id,recurrence_week,recurring_rule_revision_id)
        values(event_id,'regular-live-'||replace(event_id::text,'-',''),series_record.celebrity_id,null,'published','scheduled',v_starts_at,v_ends_at,
          pg_catalog.transaction_timestamp(),v_starts_at,series_record.rule->>'channelUrl',celebrity_record.image_url,null,
          pg_catalog.transaction_timestamp(),(series_record.rule->>'provider')::public.social_platform,series_record.rule->>'channelUrl',
          pg_catalog.transaction_timestamp(),'recurring',series_record.id,(slot->>'id')::uuid,recurrence_monday,series_record.rule_revision_id);
        insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values
          (event_id,'ko',celebrity_record.ko_name||' 정기 LIVE',celebrity_record.ko_name||'의 정기 LIVE입니다.',celebrity_record.ko_name||' 정기 LIVE'),
          (event_id,'en',celebrity_record.en_name||' Regular LIVE','A regular LIVE with '||celebrity_record.en_name||'.',celebrity_record.en_name||' regular LIVE');
        created_ids:=array_append(created_ids,event_id); created_count:=created_count+1;
      end loop;
    end loop;
  end loop;
  result:=jsonb_build_object('runId',p_run_id,'status',case when review_count>0 then 'needs_review' else 'completed' end,
    'horizonEndsAt',p_now+pg_catalog.make_interval(days=>p_horizon_days),'createdCount',created_count,'reusedCount',reused_count,
    'unchangedCount',unchanged_count,'needsReviewCount',review_count,'eventIds',to_jsonb(created_ids));
  update public.recurring_live_runs set status=(case when review_count>0 then 'needs_review' else 'completed' end)::public.recurring_live_run_status,
    completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp(),summary=summary||jsonb_build_object('replenishResult',result)
    where id=p_run_id;
  return result;
end $$;

create function public.verify_recurring_live_coverage(p_now timestamptz,p_required_days integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare series_record record; slot jsonb; week_offset integer; occurrence_date date; recurrence_monday date;
  v_starts_at timestamptz; missing jsonb; items jsonb:='[]'::jsonb; issues jsonb:='[]'::jsonb; local_date date;
  covered_until timestamptz; overall text:='completed';
begin
  if p_now is null or p_required_days not between 1 and 60 then raise exception 'RECURRING_LIVE_COVERAGE_INVALID'; end if;
  for series_record in select series.*,revision.rule from public.recurring_live_series series
    join public.recurring_live_rule_revisions revision on revision.id=series.current_rule_revision_id and revision.status='approved'
    join public.celebrities celebrity on celebrity.id=series.celebrity_id and celebrity.status='published' and celebrity.archived_at is null
    where series.status='active' order by series.celebrity_id,series.id loop
    missing:='[]'::jsonb; local_date:=(p_now at time zone (series_record.rule->>'timeZone'))::date;
    select max(live.starts_at) into covered_until from public.live_events live where live.recurring_series_id=series_record.id
      and live.publication_status='published' and live.archived_at is null;
    if exists(select 1 from public.recurring_live_rule_revisions where series_id=series_record.id and status='proposed') then
      overall:='needs_review'; issues:=issues||jsonb_build_array(jsonb_build_object('seriesId',series_record.id,'reason','pending_rule_review'));
    end if;
    for slot in select value from jsonb_array_elements(series_record.rule->'slots') loop
      for week_offset in 0..((p_required_days/7)+2) loop
        recurrence_monday:=date_trunc('week',local_date::timestamp)::date+(week_offset*7);
        occurrence_date:=recurrence_monday+((slot->>'isoWeekday')::integer-1);
        v_starts_at:=public.recurring_live_local_instant(occurrence_date,slot->>'localStartTime',series_record.rule->>'timeZone');
        if v_starts_at is null then overall:='needs_review'; continue; end if;
        if v_starts_at>p_now and v_starts_at<=p_now+pg_catalog.make_interval(days=>p_required_days)
          and occurrence_date>=(series_record.rule->>'effectiveFrom')::date
          and (series_record.rule->'effectiveUntil'='null'::jsonb or occurrence_date<=(series_record.rule->>'effectiveUntil')::date)
          and not exists(select 1 from public.live_events live where live.recurring_series_id=series_record.id
            and live.recurring_slot_id=(slot->>'id')::uuid and live.recurrence_week=recurrence_monday
            and live.publication_status='published' and live.archived_at is null) then
          missing:=missing||to_jsonb(recurrence_monday::text); if overall<>'needs_review' then overall:='incomplete'; end if;
        end if;
      end loop;
    end loop;
    items:=items||jsonb_build_array(jsonb_build_object('seriesId',series_record.id,'celebrityId',series_record.celebrity_id,
      'coveredUntil',covered_until,'missingWeeks',missing));
  end loop;
  return jsonb_build_object('requiredDays',p_required_days,'horizonEndsAt',p_now+pg_catalog.make_interval(days=>p_required_days),
    'status',overall,'series',items,'issues',issues);
end $$;

create function public.get_recurring_live_roster()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('rosterObservedAt',pg_catalog.statement_timestamp(),'celebrities',coalesce(jsonb_agg(jsonb_build_object(
    'id',celebrity.id,'slug',celebrity.slug,'nameKo',ko.name,'nameEn',en.name,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('platform',source.platform,'url',source.url) order by source.position,source.platform)
      from public.celebrity_social_links source where source.celebrity_id=celebrity.id and source.active),'[]'::jsonb),
    'latestObservation',case when observation.id is null then null else jsonb_build_object('result',observation.result,
      'verification',observation.verification,'observedAt',observation.observed_at) end,
    'latestRule',case when rule.id is null then null else jsonb_build_object('id',rule.id,'seriesId',series.id,
      'seriesKey',series.series_key,'revision',rule.revision,'rule',rule.rule) end
  ) order by celebrity.display_order,celebrity.id),'[]'::jsonb))
  from public.celebrities celebrity
  join public.celebrity_localizations ko on ko.celebrity_id=celebrity.id and ko.locale='ko'
  join public.celebrity_localizations en on en.celebrity_id=celebrity.id and en.locale='en'
  left join lateral (select item.* from public.recurring_live_observations item where item.celebrity_id=celebrity.id
    order by item.observed_at desc,item.id desc limit 1) observation on true
  left join lateral (select item.* from public.recurring_live_series item where item.celebrity_id=celebrity.id
    and item.status<>'retired' order by item.updated_at desc,item.id desc limit 1) series on true
  left join public.recurring_live_rule_revisions rule on rule.id=series.current_rule_revision_id
  where celebrity.status='published' and celebrity.archived_at is null
$$;

create function public.import_recurring_live_observations(p_run_id uuid,p_idempotency_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare input_hash text; existing public.recurring_live_runs%rowtype; creator jsonb; observation jsonb;
  series public.recurring_live_series%rowtype; current_rule public.recurring_live_rule_revisions%rowtype;
  observation_ids uuid[]; observation_id uuid; proposal_id uuid; proposal_ids uuid[]:='{}';
  v_proposal_hash text; next_revision integer; proposed_count integer:=0; observation_count integer:=0;
  missing_count integer:=0; review_count integer:=0; expected_current uuid; run_mode public.recurring_live_run_mode;
  reason public.recurring_live_rule_reason; review_rule jsonb;
  evidence_hash_basis text; review_candidate_ids uuid[];
begin
  if p_run_id is null or p_idempotency_key is null or length(pg_catalog.btrim(p_idempotency_key)) not between 8 and 200
    or jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>4
    or not (p_input ?& array['version','runId','rosterObservedAt','creators'])
    or p_input->>'version'<>'1' or (p_input->>'runId')::uuid<>p_run_id
    or jsonb_typeof(p_input->'creators')<>'array' or jsonb_array_length(p_input->'creators')>500 then
    raise exception 'RECURRING_LIVE_IMPORT_INVALID';
  end if;
  perform (p_input->>'rosterObservedAt')::timestamptz;
  input_hash:=encode(extensions.digest(pg_catalog.convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:import:'||p_idempotency_key,0));
  select * into existing from public.recurring_live_runs where idempotency_key=p_idempotency_key for update;
  if found then
    if existing.id is distinct from p_run_id or existing.input_hash is distinct from input_hash then raise exception 'RECURRING_LIVE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('runId',existing.id,'inputHash',existing.input_hash,'status',existing.status,
      'observationCount',coalesce((existing.summary->>'observationCount')::integer,0),
      'proposedRuleRevisionIds',coalesce(existing.summary->'proposedRuleRevisionIds','[]'::jsonb),
      'needsReview',existing.status='needs_review');
  end if;
  run_mode:=case when exists(select 1 from public.recurring_live_series) then 'weekly' else 'bootstrap' end;
  insert into public.recurring_live_runs(id,idempotency_key,input_hash,mode,status,roster)
  values(p_run_id,pg_catalog.btrim(p_idempotency_key),input_hash,run_mode,'running',
    jsonb_build_object('observedAt',p_input->'rosterObservedAt','celebrityIds',
      coalesce((select jsonb_agg(id) from (select (value->>'id')::uuid id from jsonb_array_elements(public.get_recurring_live_roster()->'celebrities')) roster),'[]'::jsonb)));
  for creator in select value from jsonb_array_elements(p_input->'creators') order by value->>'celebrityId' loop
    if jsonb_typeof(creator)<>'object' or (select count(*) from jsonb_object_keys(creator - 'notes'))<>7
      or (select count(*) from jsonb_object_keys(creator)) not between 7 and 8
      or not (creator ?& array['celebrityId','result','verification','observations','seriesKey','proposedRule','expectedCurrentRevisionId'])
      or creator->>'result' not in('regular','irregular','unconfirmed')
      or creator->>'verification' not in('verified','inaccessible','not_found','conflicting')
      or jsonb_typeof(creator->'observations')<>'array' or jsonb_array_length(creator->'observations')>100
      or not exists(select 1 from public.celebrities where id=(creator->>'celebrityId')::uuid and status='published' and archived_at is null) then
      raise exception 'RECURRING_LIVE_CREATOR_INPUT_INVALID';
    end if;
    observation_ids:='{}';
    for observation in select value from jsonb_array_elements(creator->'observations') loop
      if jsonb_typeof(observation)<>'object' or (select count(*) from jsonb_object_keys(observation))<>7
        or not (observation ?& array['sourceUrl','sourceAccount','sourcePublishedAt','observedAt','originalText','evidencePath','contentHash']) then
        raise exception 'RECURRING_LIVE_OBSERVATION_INVALID'; end if;
      insert into public.recurring_live_observations(run_id,celebrity_id,result,verification,source_url,source_account,
        source_published_at,observed_at,original_text,evidence_path,content_hash,normalized_rule)
      values(p_run_id,(creator->>'celebrityId')::uuid,(creator->>'result')::public.recurring_live_observation_result,
        (creator->>'verification')::public.recurring_live_verification,observation->>'sourceUrl',observation->>'sourceAccount',
        nullif(observation->>'sourcePublishedAt','')::timestamptz,(observation->>'observedAt')::timestamptz,
        observation->>'originalText',observation->>'evidencePath',lower(observation->>'contentHash'),
        nullif(creator->'proposedRule','null'::jsonb))
      returning id into observation_id;
      observation_ids:=array_append(observation_ids,observation_id); observation_count:=observation_count+1;
    end loop;
    if creator->>'verification'='conflicting' or (creator->>'verification'='verified' and creator->>'result'='irregular') then
      if cardinality(observation_ids)=0 or creator->>'seriesKey' is null then raise exception 'RECURRING_LIVE_REVIEW_EVIDENCE_REQUIRED'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||(creator->>'celebrityId'),0));
      select * into series from public.recurring_live_series where celebrity_id=(creator->>'celebrityId')::uuid
        and series_key=creator->>'seriesKey' for update;
      if found and series.current_rule_revision_id is not null then
        expected_current:=nullif(creator->>'expectedCurrentRevisionId','')::uuid;
        if series.current_rule_revision_id is distinct from expected_current then raise exception 'RECURRING_LIVE_RULE_CAS_CONFLICT'; end if;
        select * into current_rule from public.recurring_live_rule_revisions where id=series.current_rule_revision_id;
        review_rule:=case when creator->'proposedRule'<>'null'::jsonb and public.is_valid_recurring_live_rule(creator->'proposedRule')
          then creator->'proposedRule' else current_rule.rule end;
        reason:=case when creator->>'verification'='conflicting' then 'source_conflict'::public.recurring_live_rule_reason else 'hiatus' end;
        select string_agg(item.content_hash,',' order by item.content_hash) into evidence_hash_basis
          from public.recurring_live_observations item where item.id=any(observation_ids);
        v_proposal_hash:=encode(extensions.digest(pg_catalog.convert_to(review_rule::text||':'||reason::text||':'||evidence_hash_basis,'UTF8'),'sha256'),'hex');
        select coalesce(array_agg(live.id order by live.starts_at,live.id),'{}'::uuid[]) into review_candidate_ids
          from public.live_events live where live.recurring_series_id=series.id and live.publication_status='published'
            and live.archived_at is null and live.starts_at>pg_catalog.statement_timestamp();
        select item.id into proposal_id from public.recurring_live_rule_revisions item
          where item.series_id=series.id and item.status='proposed' and item.proposal_hash=v_proposal_hash;
        if proposal_id is null then
          select coalesce(max(item.revision),0)+1 into next_revision from public.recurring_live_rule_revisions item where item.series_id=series.id;
          insert into public.recurring_live_rule_revisions(series_id,revision,rule,source_observation_ids,proposal_hash,reason,review_payload)
          values(series.id,next_revision,review_rule,observation_ids,v_proposal_hash,reason,
            jsonb_build_object('runId',p_run_id,'expectedCurrentRevisionId',series.current_rule_revision_id,
              'candidateEventIds',to_jsonb(review_candidate_ids))) returning id into proposal_id;
        end if;
        proposal_ids:=array_append(proposal_ids,proposal_id); proposed_count:=proposed_count+1;
      end if;
      continue;
    elsif creator->>'result'<>'regular' or creator->>'verification'<>'verified' or creator->'proposedRule'='null'::jsonb then
      continue;
    end if;
    if cardinality(observation_ids)=0 or not public.is_valid_recurring_live_rule(creator->'proposedRule')
      or creator->>'seriesKey' is null or creator->>'seriesKey' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
      raise exception 'RECURRING_LIVE_RULE_INVALID'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||(creator->>'celebrityId'),0));
    select * into series from public.recurring_live_series where celebrity_id=(creator->>'celebrityId')::uuid
      and series_key=creator->>'seriesKey' for update;
    if not found then
      if creator->'expectedCurrentRevisionId'<>'null'::jsonb then raise exception 'RECURRING_LIVE_RULE_CAS_CONFLICT'; end if;
      insert into public.recurring_live_series(celebrity_id,series_key) values((creator->>'celebrityId')::uuid,creator->>'seriesKey') returning * into series;
    else
      expected_current:=nullif(creator->>'expectedCurrentRevisionId','')::uuid;
      if series.current_rule_revision_id is distinct from expected_current then raise exception 'RECURRING_LIVE_RULE_CAS_CONFLICT'; end if;
    end if;
    select * into current_rule from public.recurring_live_rule_revisions where id=series.current_rule_revision_id;
    v_proposal_hash:=encode(extensions.digest(pg_catalog.convert_to((creator->'proposedRule')::text,'UTF8'),'sha256'),'hex');
    if current_rule.id is not null and current_rule.proposal_hash=v_proposal_hash then continue; end if;
    select item.id into proposal_id from public.recurring_live_rule_revisions item
      where item.series_id=series.id and item.status='proposed' and item.proposal_hash=v_proposal_hash;
    if proposal_id is null then
      select coalesce(max(revision),0)+1 into next_revision from public.recurring_live_rule_revisions where series_id=series.id;
      reason:=case when creator->>'verification'='conflicting' then 'source_conflict'::public.recurring_live_rule_reason
        when series.current_rule_revision_id is null then 'initial' else 'rule_change' end;
      insert into public.recurring_live_rule_revisions(series_id,revision,rule,source_observation_ids,proposal_hash,reason,review_payload)
      values(series.id,next_revision,creator->'proposedRule',observation_ids,v_proposal_hash,reason,
        jsonb_build_object('runId',p_run_id,'expectedCurrentRevisionId',series.current_rule_revision_id,
          'notes',coalesce(creator->'notes','null'::jsonb))) returning id into proposal_id;
    end if;
    proposal_ids:=array_append(proposal_ids,proposal_id); proposed_count:=proposed_count+1;
  end loop;
  select count(*) into missing_count from jsonb_array_elements(public.get_recurring_live_roster()->'celebrities') roster
    where not exists(select 1 from jsonb_array_elements(p_input->'creators') input where input->>'celebrityId'=roster->>'id');
  update public.recurring_live_runs set status=(case when proposed_count+review_count+missing_count>0 then 'needs_review' else 'completed' end)::public.recurring_live_run_status,
    completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp(),summary=jsonb_build_object(
      'observationCount',observation_count,'proposedRuleRevisionIds',to_jsonb(proposal_ids),
      'missingCreatorCount',missing_count,'reviewCount',review_count)
  where id=p_run_id returning * into existing;
  return jsonb_build_object('runId',p_run_id,'inputHash',input_hash,'status',existing.status,
    'observationCount',observation_count,'proposedRuleRevisionIds',to_jsonb(proposal_ids),'needsReview',existing.status='needs_review');
exception when others then
  if p_run_id is not null and exists(select 1 from public.recurring_live_runs where id=p_run_id) then
    update public.recurring_live_runs set status='failed',completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp(),
      summary=jsonb_build_object('error','import failed') where id=p_run_id;
  end if;
  raise;
end $$;

create function public.approve_initial_recurring_live_rules(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_run_id uuid,p_expected_input_hash text,
  p_rule_revision_ids uuid[],p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.recurring_live_runs%rowtype; revision public.recurring_live_rule_revisions%rowtype; approved uuid[]:='{}';
  target_revision_id uuid; creator_id uuid;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_rule_revision_ids is null or cardinality(p_rule_revision_ids)>100
    or array_position(p_rule_revision_ids,null) is not null
    or (select count(distinct id) from unnest(p_rule_revision_ids) id)<>cardinality(p_rule_revision_ids) then
    raise exception 'RECURRING_LIVE_APPROVAL_INVALID'; end if;
  select * into run from public.recurring_live_runs where id=p_run_id for update;
  if not found or run.input_hash is distinct from p_expected_input_hash then raise exception 'RECURRING_LIVE_APPROVAL_HASH_CONFLICT'; end if;
  if cardinality(p_rule_revision_ids)=0 and jsonb_typeof(run.summary->'approvedRuleRevisionIds')='array' then
    return jsonb_build_object('runId',p_run_id,'status','completed',
      'approvedRuleRevisionIds',run.summary->'approvedRuleRevisionIds');
  elsif cardinality(p_rule_revision_ids)=0 then
    raise exception 'RECURRING_LIVE_APPROVAL_INVALID';
  end if;
  for target_revision_id in select item.id from public.recurring_live_rule_revisions item
    join public.recurring_live_series series on series.id=item.series_id
    where item.id=any(p_rule_revision_ids) order by series.celebrity_id,item.series_id,item.revision loop
    select series.celebrity_id into strict creator_id from public.recurring_live_rule_revisions item
      join public.recurring_live_series series on series.id=item.series_id where item.id=target_revision_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||creator_id::text,0));
    select * into strict revision from public.recurring_live_rule_revisions where id=target_revision_id for update;
    if revision.status<>'proposed' or revision.reason<>'initial'
      or not exists(select 1 from public.recurring_live_observations observation
        where observation.id=any(revision.source_observation_ids) and observation.run_id=p_run_id) then
      raise exception 'RECURRING_LIVE_INITIAL_RULE_INVALID'; end if;
    perform 1 from public.recurring_live_series where id=revision.series_id and current_rule_revision_id is null for update;
    if not found then raise exception 'RECURRING_LIVE_RULE_CAS_CONFLICT'; end if;
    update public.recurring_live_rule_revisions set status='approved',approved_actor_app_user_id=p_actor_app_user_id,
      approved_actor_admin_allowlist_id=p_actor_admin_allowlist_id,approved_at=pg_catalog.clock_timestamp() where id=revision.id;
    update public.recurring_live_series set current_rule_revision_id=revision.id,updated_at=pg_catalog.clock_timestamp() where id=revision.series_id;
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'recurring_live.rule.approved','recurring_live_rule_revision',revision.id::text,
      jsonb_build_object('runId',p_run_id,'seriesId',revision.series_id,'revision',revision.revision),p_correlation_id);
    approved:=array_append(approved,revision.id);
  end loop;
  if cardinality(approved)<>cardinality(p_rule_revision_ids) then raise exception 'RECURRING_LIVE_APPROVAL_SET_MISMATCH'; end if;
  update public.recurring_live_runs set status='completed',completed_at=coalesce(completed_at,pg_catalog.clock_timestamp()),
    updated_at=pg_catalog.clock_timestamp(),summary=summary||jsonb_build_object('approvedRuleRevisionIds',to_jsonb(approved)) where id=p_run_id;
  return jsonb_build_object('runId',p_run_id,'status','completed','approvedRuleRevisionIds',to_jsonb(approved));
end $$;

revoke all on function public.is_valid_recurring_live_channel_url(text,text),
  public.is_valid_recurring_live_rule(jsonb),public.recurring_live_local_instant(date,text,text)
from public,anon,authenticated,service_role;
revoke all on function public.get_recurring_live_roster(),
  public.import_recurring_live_observations(uuid,text,jsonb),
  public.approve_initial_recurring_live_rules(uuid,uuid,uuid,text,uuid[],uuid),
  public.replenish_recurring_live_events(uuid,integer,timestamptz),
  public.get_admin_recurring_live_schedules(uuid,uuid),
  public.resolve_admin_recurring_live_review(uuid,uuid,uuid,uuid,jsonb,uuid),
  public.verify_recurring_live_coverage(timestamptz,integer)
from public,anon,authenticated;
grant execute on function public.get_recurring_live_roster(),
  public.import_recurring_live_observations(uuid,text,jsonb),
  public.approve_initial_recurring_live_rules(uuid,uuid,uuid,text,uuid[],uuid),
  public.replenish_recurring_live_events(uuid,integer,timestamptz),
  public.get_admin_recurring_live_schedules(uuid,uuid),
  public.resolve_admin_recurring_live_review(uuid,uuid,uuid,uuid,jsonb,uuid),
  public.verify_recurring_live_coverage(timestamptz,integer)
to service_role;
