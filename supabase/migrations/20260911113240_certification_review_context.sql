-- Enrich the service-only certification queue with the context an administrator
-- needs to review a proof without changing the original queue or proof access.
create or replace function public.get_admin_certification_queue(
  p_actor uuid,
  p_allowlist uuid,
  p_status public.certification_submission_status default 'pending'
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      public.certification_membership_payload(
        rows.item,
        submission.membership_platform
      ) || jsonb_build_object(
        'applicantName', profile.nickname,
        'creatorNameKo', creator_ko.name,
        'creatorNameEn', creator_en.name,
        'missionTitleEn', mission.title_en,
        'instructionsKo', mission.instructions_ko,
        'instructionsEn', mission.instructions_en,
        'reviewedAt', submission.reviewed_at,
        'rejectionReason', submission.rejection_reason,
        'previousSubmissionId', submission.previous_submission_id
      )
      order by rows.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    public.get_admin_certification_queue_before_membership(
      p_actor,
      p_allowlist,
      p_status
    )
  ) with ordinality as rows(item, ordinality)
  left join public.certification_submissions submission
    on submission.id = (rows.item->>'id')::uuid
  left join public.certification_missions mission
    on mission.id = submission.mission_id
  left join public.user_profiles profile
    on profile.app_user_id = submission.app_user_id
  left join public.celebrity_localizations creator_ko
    on creator_ko.celebrity_id = submission.celebrity_id
   and creator_ko.locale = 'ko'
  left join public.celebrity_localizations creator_en
    on creator_en.celebrity_id = submission.celebrity_id
   and creator_en.locale = 'en';
$$;

revoke all on function public.get_admin_certification_queue(
  uuid,
  uuid,
  public.certification_submission_status
) from public, anon, authenticated;
grant execute on function public.get_admin_certification_queue(
  uuid,
  uuid,
  public.certification_submission_status
) to service_role;
