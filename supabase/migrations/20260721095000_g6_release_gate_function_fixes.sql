-- G6 release gate: remove PL/pgSQL identifier ambiguity from three production
-- mutation paths. This is a forward-only correction; privileges are preserved
-- by CREATE OR REPLACE on the existing signatures.

create or replace function public.evaluate_live_attendance_code(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_idempotency_key uuid,
  p_normalized_code text,
  p_input_format_valid boolean,
  p_fan_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attempt public.attendance_verification_attempts%rowtype;
  rate_state public.attendance_rate_limits%rowtype;
  attempt_category text;
  next_failed_count smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select attempt.* into existing_attempt
  from public.attendance_verification_attempts attempt
  where attempt.idempotency_key = p_idempotency_key;
  if found then
    if existing_attempt.app_user_id <> p_app_user_id
       or existing_attempt.live_event_id <> p_live_event_id then
      raise exception 'G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    return existing_attempt.category;
  end if;

  insert into public.attendance_rate_limits(app_user_id, live_event_id)
  values (p_app_user_id, p_live_event_id)
  on conflict (app_user_id, live_event_id) do nothing;

  select rate.* into strict rate_state
  from public.attendance_rate_limits rate
  where rate.app_user_id = p_app_user_id
    and rate.live_event_id = p_live_event_id
  for update;

  if rate_state.blocked_until is not null and v_now < rate_state.blocked_until then
    insert into public.attendance_verification_attempts(
      app_user_id, live_event_id, idempotency_key, category, attempted_at
    ) values (
      p_app_user_id, p_live_event_id, p_idempotency_key, 'rate_limited', v_now
    );
    return 'rate_limited';
  end if;

  if rate_state.blocked_until is not null
     or v_now >= rate_state.window_started_at + interval '10 minutes' then
    update public.attendance_rate_limits
    set failed_count = 0,
        window_started_at = v_now,
        blocked_until = null,
        updated_at = v_now
    where app_user_id = p_app_user_id and live_event_id = p_live_event_id;
    rate_state.failed_count := 0;
    rate_state.window_started_at := v_now;
  end if;

  if not p_input_format_valid then
    attempt_category := 'invalid_format';
  elsif extensions.crypt(p_normalized_code, p_fan_code_hash)
        is distinct from p_fan_code_hash then
    attempt_category := 'invalid_code';
  else
    return 'success';
  end if;

  next_failed_count := least(rate_state.failed_count + 1, 5)::smallint;
  update public.attendance_rate_limits
  set failed_count = next_failed_count,
      blocked_until = case
        when next_failed_count = 5 then v_now + interval '15 minutes'
        else null
      end,
      updated_at = v_now
  where app_user_id = p_app_user_id and live_event_id = p_live_event_id;

  insert into public.attendance_verification_attempts(
    app_user_id, live_event_id, idempotency_key, category, attempted_at
  ) values (
    p_app_user_id, p_live_event_id, p_idempotency_key, attempt_category, v_now
  );
  return attempt_category;
end;
$$;

create or replace function public.validate_and_replace_live_survey_answers(
  p_response_id uuid, p_survey_id uuid, p_answers jsonb, p_require_complete boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; question_record public.live_survey_questions%rowtype; v_question_id uuid;
  selected_ids uuid[]; rating_value smallint; free_text_value text;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 100 then
    raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) value where jsonb_typeof(value) <> 'object')
     or (select count(*) from jsonb_array_elements(p_answers)) <>
        (select count(distinct value ->> 'questionId') from jsonb_array_elements(p_answers) value) then
    raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023';
  end if;
  delete from public.live_survey_answers answer where answer.response_id = p_response_id;
  for item in select value from jsonb_array_elements(p_answers) value loop
    begin v_question_id := (item ->> 'questionId')::uuid;
    exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
    select question.* into question_record from public.live_survey_questions question
    where question.id = v_question_id and question.survey_id = p_survey_id;
    if not found then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
    if question_record.question_type in ('single_choice', 'multiple_choice') then
      if not (item ? 'selectedOptionIds') or jsonb_typeof(item -> 'selectedOptionIds') <> 'array'
         or item ? 'rating' or item ? 'freeText' then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      begin select array_agg(value::uuid order by value) into selected_ids from jsonb_array_elements_text(item -> 'selectedOptionIds') value;
      exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
      if selected_ids is null or cardinality(selected_ids) = 0
         or cardinality(selected_ids) <> (select count(distinct value) from unnest(selected_ids) value)
         or (question_record.question_type = 'single_choice' and cardinality(selected_ids) <> 1)
         or exists (select 1 from unnest(selected_ids) selected_option_id where not exists (
           select 1 from public.live_survey_options option
           where option.id = selected_option_id and option.question_id = v_question_id
         )) then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, selected_option_ids)
      values (p_response_id, v_question_id, selected_ids);
    elsif question_record.question_type = 'rating_1_5' then
      if not (item ? 'rating') or item ? 'selectedOptionIds' or item ? 'freeText' then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      begin rating_value := (item ->> 'rating')::smallint;
      exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
      if rating_value not between 1 and 5 then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, rating)
      values (p_response_id, v_question_id, rating_value);
    else
      if not (item ? 'freeText') or item ? 'selectedOptionIds' or item ? 'rating'
         or jsonb_typeof(item -> 'freeText') <> 'string' then
        raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      free_text_value := item ->> 'freeText';
      if length(free_text_value) > 4000 or (p_require_complete and length(trim(free_text_value)) = 0) then
        raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, free_text)
      values (p_response_id, v_question_id, free_text_value);
    end if;
  end loop;
  if p_require_complete and exists (
    select 1 from public.live_survey_questions question
    where question.survey_id = p_survey_id and question.is_required
      and not exists (select 1 from public.live_survey_answers answer
        where answer.response_id = p_response_id and answer.question_id = question.id)
  ) then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
end;
$$;

create or replace function public.save_admin_celebrity(
  p_actor uuid, p_correlation uuid, p_celebrity uuid, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_target uuid := coalesce(p_celebrity, extensions.gen_random_uuid()); before_row jsonb; result jsonb;
  theme_item jsonb; social_item jsonb; v_theme_id uuid;
begin
  perform public.require_content_editor(p_actor,true);
  if p_correlation is null then raise exception 'correlation id is required'; end if;
  if p_celebrity is not null then
    perform 1 from public.celebrities celebrity where celebrity.id=p_celebrity and celebrity.archived_at is null for update;
    if not found then raise exception 'content not found'; end if;
    before_row := public.read_admin_celebrity_cms(p_actor,p_celebrity)->0;
  end if;
  if coalesce(p_payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid celebrity slug'; end if;
  if p_celebrity is null then
    insert into public.celebrities(id,slug,image_url,image_position,display_order)
    values(v_target,p_payload->>'slug',p_payload->>'imageUrl',coalesce(nullif(p_payload->>'imagePosition',''),'center'),coalesce((p_payload->>'displayOrder')::int,0));
  else
    update public.celebrities celebrity set slug=p_payload->>'slug',image_url=p_payload->>'imageUrl',
      image_position=coalesce(nullif(p_payload->>'imagePosition',''),'center'),display_order=coalesce((p_payload->>'displayOrder')::int,0)
    where celebrity.id=v_target;
  end if;
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
  select v_target, x.locale::public.content_locale, x.value->>'name',x.value->>'summary',x.value->>'imageAlt'
  from jsonb_each(p_payload->'localizations') x(locale,value)
  on conflict(celebrity_id,locale) do update set name=excluded.name,summary=excluded.summary,image_alt=excluded.image_alt;
  delete from public.celebrity_social_links social where social.celebrity_id=v_target;
  for social_item in select value from jsonb_array_elements(coalesce(p_payload->'socialLinks','[]')) loop
    insert into public.celebrity_social_links(celebrity_id,platform,url,position,active)
    values(v_target,(social_item->>'platform')::public.social_platform,social_item->>'url',(social_item->>'position')::smallint,coalesce((social_item->>'active')::boolean,true));
  end loop;
  delete from public.celebrity_themes celebrity_theme where celebrity_theme.celebrity_id=v_target;
  for theme_item in select value from jsonb_array_elements(coalesce(p_payload->'themes','[]')) loop
    v_theme_id := null;
    select theme.id into v_theme_id from public.themes theme where theme.slug=theme_item->>'slug' for update;
    if v_theme_id is null then
      insert into public.themes(slug) values(theme_item->>'slug') returning id into v_theme_id;
      insert into public.theme_localizations(theme_id,locale,name)
      values(v_theme_id,'ko',theme_item->>'nameKo'),(v_theme_id,'en',theme_item->>'nameEn');
      update public.themes theme set status='published' where theme.id=v_theme_id;
    else
      insert into public.theme_localizations(theme_id,locale,name)
      values(v_theme_id,'ko',theme_item->>'nameKo'),(v_theme_id,'en',theme_item->>'nameEn')
      on conflict(theme_id,locale) do update set name=excluded.name;
      if exists(select 1 from public.themes theme where theme.id=v_theme_id and theme.status='draft') then
        update public.themes theme set status='published' where theme.id=v_theme_id;
      end if;
    end if;
    insert into public.celebrity_themes(celebrity_id,theme_id,position)
    values(v_target,v_theme_id,(theme_item->>'position')::smallint);
  end loop;
  select (public.read_admin_celebrity_cms(p_actor,v_target)->0) into result;
  insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor,case when p_celebrity is null then 'celebrity.created' else 'celebrity.updated' end,
    'celebrity',v_target::text,jsonb_build_object('before',before_row,'after',result),p_correlation);
  return result;
end $$;

