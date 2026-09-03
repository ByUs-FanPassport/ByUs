-- Preserve localized option labels as accessible names while allowing the fan
-- surface to present text-only, media-only, or text+media choices.

alter table public.live_survey_options add column display_mode text;

-- Existing published option snapshots are immutable to application traffic.
-- Suspend only that named guard for this deterministic schema backfill.
alter table public.live_survey_options disable trigger live_survey_options_protect_snapshot;
update public.live_survey_options
set display_mode=case when media_type is null then 'text' else 'text_media' end;
alter table public.live_survey_options enable trigger live_survey_options_protect_snapshot;

alter table public.live_survey_options
  alter column display_mode set default 'text',
  alter column display_mode set not null,
  add constraint live_survey_options_display_mode_valid check (
    display_mode in ('text','media','text_media') and (
      (display_mode='text' and media_type is null) or
      (display_mode in ('media','text_media') and media_type is not null)
    )
  );

create or replace function public.get_owned_live_missions(p_app_user_id uuid,p_live_slug text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'type',m.mission_type,'version',m.version,
    'title',ml.title,'description',ml.description,
    'visibleFrom',m.visible_from,'visibleUntil',m.visible_until,
    'attendanceRequired',m.attendance_requirement='required',
    'completed',exists(select 1 from public.live_survey_responses r where r.survey_id=m.id and r.app_user_id=p_app_user_id and r.status='submitted'),
    'questions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.id,'text',ql.question_text,'media',case when q.media_type is null then null else jsonb_build_object('type',q.media_type,'url',q.media_url) end,
      'options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',ol.label,'displayMode',o.display_mode,
        'media',case when o.media_type is null then null else jsonb_build_object('type',o.media_type,'url',o.media_url) end) order by o.position),'[]'::jsonb)
        from public.live_survey_options o join public.live_survey_option_localizations ol on ol.option_id=o.id and ol.locale=p_locale where o.question_id=q.id)
    ) order by q.position),'[]'::jsonb) from public.live_survey_questions q
      join public.live_survey_question_localizations ql on ql.question_id=q.id and ql.locale=p_locale where q.survey_id=m.id)
  ) order by m.version), '[]'::jsonb)
  from public.live_surveys m join public.live_events l on l.id=m.live_event_id
  join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale
  where l.slug=p_live_slug and m.publication_status='published' and not m.legacy_contract
    and statement_timestamp() >= m.visible_from and statement_timestamp() < m.visible_until;
$$;

create or replace function public.admin_write_live_mission(
  p_actor_app_user_id uuid,p_actor_allowlist_id uuid,p_live_event_id uuid,p_command text,p_payload jsonb,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission_id uuid; next_version integer; question_item jsonb; option_item jsonb; question_id uuid; option_id uuid; correct_position integer;
  v_visible_from timestamptz; v_visible_until timestamptz; v_display_mode text;
begin
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id,p_actor_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:admin:'||p_live_event_id::text,0));
  if p_command in ('create','update') then
    if p_payload->>'type' not in ('quiz','survey','vote') or p_payload->>'attendanceRequirement' not in ('required','not_required') then raise exception 'invalid mission contract'; end if;
    v_visible_from:=(p_payload->>'visibleFrom')::timestamptz; v_visible_until:=(p_payload->>'visibleUntil')::timestamptz;
    if v_visible_from is null or v_visible_until is null or v_visible_from>=v_visible_until then raise exception 'invalid mission visibility window'; end if;
    if p_command='create' then
      select coalesce(max(version),0)+1 into next_version from public.live_surveys where live_event_id=p_live_event_id;
      insert into public.live_surveys(live_event_id,version,mission_type,legacy_contract,attendance_requirement,visible_from,visible_until)
      values(p_live_event_id,next_version,p_payload->>'type',false,p_payload->>'attendanceRequirement',v_visible_from,v_visible_until) returning id into mission_id;
    else
      mission_id:=(p_payload->>'missionId')::uuid;
      perform 1 from public.live_surveys where id=mission_id and live_event_id=p_live_event_id and not legacy_contract and lifecycle_status='draft' for update;
      if not found then raise exception 'draft mission not found'; end if;
      update public.live_survey_questions set correct_option_id=null where survey_id=mission_id;
      delete from public.live_survey_option_localizations where option_id in (select o.id from public.live_survey_options o join public.live_survey_questions q on q.id=o.question_id where q.survey_id=mission_id);
      delete from public.live_survey_options where question_id in (select id from public.live_survey_questions where survey_id=mission_id);
      delete from public.live_survey_question_localizations where question_id in (select id from public.live_survey_questions where survey_id=mission_id);
      delete from public.live_survey_questions where survey_id=mission_id;
      delete from public.live_survey_localizations where survey_id=mission_id;
      update public.live_surveys set mission_type=p_payload->>'type',attendance_requirement=p_payload->>'attendanceRequirement',visible_from=v_visible_from,visible_until=v_visible_until,revision=revision+1 where id=mission_id;
    end if;
    insert into public.live_survey_localizations(survey_id,locale,title,description) values
      (mission_id,'ko',p_payload->'title'->>'ko',coalesce(p_payload->'description'->>'ko','')),(mission_id,'en',p_payload->'title'->>'en',coalesce(p_payload->'description'->>'en',''));
    for question_item in select value from jsonb_array_elements(p_payload->'questions') loop
      insert into public.live_survey_questions(survey_id,question_type,is_required,position,media_type,media_url)
      values(mission_id,'single_choice',true,(question_item->>'position')::smallint,question_item->'media'->>'type',question_item->'media'->>'url') returning id into question_id;
      insert into public.live_survey_question_localizations(question_id,locale,question_text) values (question_id,'ko',question_item->'text'->>'ko'),(question_id,'en',question_item->'text'->>'en');
      correct_position:=nullif(question_item->>'correctPosition','')::integer;
      for option_item in select value from jsonb_array_elements(question_item->'options') loop
        v_display_mode:=option_item->>'displayMode';
        if v_display_mode not in ('text','media','text_media') then raise exception 'invalid mission option display mode'; end if;
        insert into public.live_survey_options(question_id,position,display_mode,media_type,media_url)
        values(question_id,(option_item->>'position')::smallint,v_display_mode,option_item->'media'->>'type',option_item->'media'->>'url') returning id into option_id;
        insert into public.live_survey_option_localizations(option_id,locale,label) values (option_id,'ko',option_item->'label'->>'ko'),(option_id,'en',option_item->'label'->>'en');
        if (option_item->>'position')::integer=correct_position then update public.live_survey_questions set correct_option_id=option_id where id=question_id; end if;
      end loop;
    end loop;
    perform public.validate_phase2_mission_contract(mission_id);
  elsif p_command='publish' then
    mission_id:=(p_payload->>'missionId')::uuid; perform public.validate_phase2_mission_contract(mission_id);
    update public.live_surveys set publication_status='published',lifecycle_status='published',published_at=now(),ever_published_at=coalesce(ever_published_at,now()),revision=revision+1
    where id=mission_id and live_event_id=p_live_event_id and not legacy_contract and lifecycle_status='draft';
    if not found then raise exception 'publishable mission not found'; end if;
  else raise exception 'unsupported mission command'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_allowlist_id,'admin.mission.'||p_command,'live_survey',mission_id::text,jsonb_build_object('missionId',mission_id,'command',p_command),p_correlation_id);
  return jsonb_build_object('missionId',mission_id);
end $$;
