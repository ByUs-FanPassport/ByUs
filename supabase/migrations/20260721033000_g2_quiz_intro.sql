-- Minimal answer-free FAN-006 public quiz availability projection.

create function public.get_published_quiz_intro(
  p_slug text,
  p_locale public.content_locale
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'celebrity', jsonb_build_object(
      'slug', c.slug,
      'name', localization.name
    ),
    'quiz', jsonb_build_object(
      'availability', case
        when coalesce(bank.valid_question_count, 0) >= 3 then 'available'
        else 'unavailable'
      end,
      'totalQuestions', 3,
      'passThreshold', 2
    )
  )
  from public.celebrities c
  join public.celebrity_localizations localization
    on localization.celebrity_id = c.id
   and localization.locale = p_locale
  left join lateral (
    select count(*)::integer as valid_question_count
    from public.celebrity_quizzes quiz
    join public.celebrity_quiz_questions question
      on question.quiz_id = quiz.id
     and question.active
    where quiz.celebrity_id = c.id
      and quiz.status = 'published'
      and (
        select count(*)
        from public.celebrity_quiz_options option
        where option.question_id = question.id
          and option.active
      ) >= 2
      and (
        select count(*)
        from public.celebrity_quiz_options option
        where option.question_id = question.id
          and option.active
          and option.is_correct
      ) = 1
  ) bank on true
  where c.slug = p_slug
    and c.status = 'published';
$$;

revoke all on function public.get_published_quiz_intro(text, public.content_locale) from public, anon, authenticated;
grant execute on function public.get_published_quiz_intro(text, public.content_locale) to service_role;

comment on function public.get_published_quiz_intro(text, public.content_locale) is
  'Returns only localized celebrity identity and fixed FAN-006 quiz availability; never quiz bank content or identifiers.';
