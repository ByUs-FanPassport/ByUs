-- Phase 01 LIVE reward settings. Every edit and publication is a new immutable
-- revision. Survey binding and issuance markers freeze the exact revision used.

create table public.live_reward_setting_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  revision integer not null check (revision > 0),
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  lifecycle_status text not null check (lifecycle_status in ('draft','published')),
  mission_score integer not null check (mission_score between 0 and 3),
  mission_ticket integer not null check (mission_ticket between 0 and 2),
  journey_bonus_ticket integer not null check (journey_bonus_ticket between 0 and 5),
  actor_app_user_id uuid references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  source_revision_id uuid references public.live_reward_setting_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (live_event_id, revision),
  constraint live_reward_setting_publication_state check (
    (lifecycle_status='draft' and published_at is null) or
    (lifecycle_status='published' and published_at is not null)
  )
);

create table public.live_survey_reward_setting_bindings (
  survey_id uuid primary key references public.live_surveys(id) on delete restrict,
  reward_setting_revision_id uuid not null references public.live_reward_setting_revisions(id) on delete restrict,
  bound_at timestamptz not null default now()
);

create table public.live_reward_setting_issuance_freezes (
  reward_setting_revision_id uuid primary key references public.live_reward_setting_revisions(id) on delete restrict,
  first_issued_at timestamptz not null,
  source_type text not null check (length(btrim(source_type)) between 1 and 80),
  source_id uuid not null
);

alter table public.fan_ticket_ledger
  add constraint fan_ticket_ledger_reward_setting_revision_fk
  foreign key (reward_setting_revision_id)
  references public.live_reward_setting_revisions(id) on delete restrict;

create function public.validate_fan_ticket_reward_setting_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reward_setting_revision_id is not null and not exists (
    select 1
    from public.live_reward_setting_revisions setting
    join public.live_events live on live.id=setting.live_event_id
    where setting.id=new.reward_setting_revision_id
      and setting.revision=new.setting_revision
      and setting.policy_version=new.policy_version
      and live.celebrity_id=new.celebrity_id
  ) then
    raise exception 'PHASE1_TICKET_SETTING_IDENTITY_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger fan_ticket_reward_setting_identity_valid
before insert on public.fan_ticket_ledger
for each row execute function public.validate_fan_ticket_reward_setting_identity();

create function public.reject_live_reward_setting_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name='live_survey_reward_setting_bindings' then
    raise exception 'survey reward binding is immutable';
  elsif tg_table_name='live_reward_setting_issuance_freezes' then
    raise exception 'reward settings with issuance are immutable';
  end if;
  raise exception 'published reward settings are immutable';
end;
$$;

create trigger live_reward_setting_revisions_immutable before update or delete
on public.live_reward_setting_revisions for each row execute function public.reject_live_reward_setting_mutation();
create trigger live_reward_setting_revisions_reject_truncate before truncate
on public.live_reward_setting_revisions for each statement execute function public.reject_live_reward_setting_mutation();
create trigger live_survey_reward_setting_bindings_immutable before update or delete
on public.live_survey_reward_setting_bindings for each row execute function public.reject_live_reward_setting_mutation();
create trigger live_survey_reward_setting_bindings_reject_truncate before truncate
on public.live_survey_reward_setting_bindings for each statement execute function public.reject_live_reward_setting_mutation();
create trigger live_reward_setting_issuance_freezes_immutable before update or delete
on public.live_reward_setting_issuance_freezes for each row execute function public.reject_live_reward_setting_mutation();
create trigger live_reward_setting_issuance_freezes_reject_truncate before truncate
on public.live_reward_setting_issuance_freezes for each statement execute function public.reject_live_reward_setting_mutation();

-- Defaults always come from the active immutable policy. Bootstrap rows
-- intentionally have no human actor but remain correlated.
insert into public.live_reward_setting_revisions(
  live_event_id,revision,policy_version,lifecycle_status,mission_score,
  mission_ticket,journey_bonus_ticket,correlation_id
)
select l.id,1,policy.version,'draft',policy.mission_score_default,
  policy.mission_ticket_default,policy.journey_ticket_default,extensions.gen_random_uuid()
from public.live_events l
cross join public.reward_policy_activation activation
join public.reward_policy_versions policy on policy.version=activation.policy_version
where not exists(select 1 from public.live_reward_setting_revisions r where r.live_event_id=l.id);

create function public.create_default_live_reward_settings()
returns trigger language plpgsql set search_path = '' as $$
declare policy public.reward_policy_versions%rowtype;
begin
  select p.* into strict policy
  from public.reward_policy_activation activation
  join public.reward_policy_versions p on p.version=activation.policy_version
  where activation.singleton=true;
  insert into public.live_reward_setting_revisions(
    live_event_id,revision,policy_version,lifecycle_status,mission_score,
    mission_ticket,journey_bonus_ticket,correlation_id
  ) values (new.id, 1, policy.version, 'draft', policy.mission_score_default,
    policy.mission_ticket_default, policy.journey_ticket_default, extensions.gen_random_uuid());
  return new;
end;
$$;
create trigger live_events_create_default_reward_settings after insert on public.live_events
for each row execute function public.create_default_live_reward_settings();

create function public.save_admin_live_reward_settings(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_live_event_id uuid,p_expected_revision integer,p_mission_score integer,
  p_mission_ticket integer,p_journey_bonus_ticket integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_row public.live_reward_setting_revisions%rowtype;
  policy public.reward_policy_versions%rowtype; next_row public.live_reward_setting_revisions%rowtype;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform 1 from public.live_events where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'live event not found'; end if;
  if public.live_effective_status_at(p_live_event_id,now())='ended' then raise exception 'ended live reward settings are read only'; end if;
  select * into current_row from public.live_reward_setting_revisions
    where live_event_id=p_live_event_id order by revision desc limit 1 for update;
  if coalesce(current_row.revision,0)<>p_expected_revision then raise exception 'stale reward settings revision'; end if;
  select p.* into strict policy
  from public.reward_policy_activation activation
  join public.reward_policy_versions p on p.version=activation.policy_version
  where activation.singleton=true;
  if p_mission_score not between policy.mission_score_min and policy.mission_score_max
    or p_mission_ticket not between policy.mission_ticket_min and policy.mission_ticket_max
    or p_journey_bonus_ticket not between policy.journey_ticket_min and policy.journey_ticket_max
  then raise exception 'reward settings exceed policy bounds'; end if;
  insert into public.live_reward_setting_revisions(
    live_event_id,revision,policy_version,lifecycle_status,mission_score,mission_ticket,
    journey_bonus_ticket,actor_app_user_id,actor_admin_allowlist_id,correlation_id,source_revision_id
  ) values (p_live_event_id,p_expected_revision+1,policy.version,'draft',p_mission_score,p_mission_ticket,
    p_journey_bonus_ticket,p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,current_row.id)
  returning * into next_row;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.reward_settings.draft_saved','live_event',p_live_event_id::text,
    jsonb_build_object('before',to_jsonb(current_row)-array['actor_app_user_id','actor_admin_allowlist_id','correlation_id'],
      'after',to_jsonb(next_row)-array['actor_app_user_id','actor_admin_allowlist_id','correlation_id']),p_correlation_id);
  return jsonb_build_object('revisionId',next_row.id,'revision',next_row.revision);
end;
$$;

create function public.publish_admin_live_reward_settings(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_live_event_id uuid,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_row public.live_reward_setting_revisions%rowtype; published_row public.live_reward_setting_revisions%rowtype;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform 1 from public.live_events where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'live event not found'; end if;
  if public.live_effective_status_at(p_live_event_id,now())='ended' then raise exception 'ended live reward settings are read only'; end if;
  select * into current_row from public.live_reward_setting_revisions where live_event_id=p_live_event_id
    order by revision desc limit 1 for update;
  if current_row.revision<>p_expected_revision then raise exception 'stale reward settings revision'; end if;
  if current_row.lifecycle_status<>'draft' then raise exception 'published reward settings are immutable'; end if;
  insert into public.live_reward_setting_revisions(
    live_event_id,revision,policy_version,lifecycle_status,mission_score,mission_ticket,
    journey_bonus_ticket,actor_app_user_id,actor_admin_allowlist_id,correlation_id,source_revision_id,published_at
  ) values (p_live_event_id,current_row.revision+1,current_row.policy_version,'published',current_row.mission_score,
    current_row.mission_ticket,current_row.journey_bonus_ticket,p_actor_app_user_id,p_actor_admin_allowlist_id,
    p_correlation_id,current_row.id,now()) returning * into published_row;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.reward_settings.published','live_event',p_live_event_id::text,
    jsonb_build_object('before',to_jsonb(current_row),'after',to_jsonb(published_row)),p_correlation_id);
  return jsonb_build_object('revisionId',published_row.id,'revision',published_row.revision);
end;
$$;

create function public.bind_live_survey_reward_settings(p_survey_id uuid,p_reward_setting_revision_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.live_reward_setting_revisions r join public.live_surveys s
    on s.live_event_id=r.live_event_id where r.id=p_reward_setting_revision_id and r.lifecycle_status='published'
      and s.id=p_survey_id) then raise exception 'published reward revision is required'; end if;
  insert into public.live_survey_reward_setting_bindings(survey_id,reward_setting_revision_id)
  values(p_survey_id,p_reward_setting_revision_id);
exception when unique_violation then
  if not exists(select 1 from public.live_survey_reward_setting_bindings
    where survey_id=p_survey_id and reward_setting_revision_id=p_reward_setting_revision_id)
  then raise exception 'survey reward binding is immutable'; end if;
end;
$$;

create function public.freeze_live_reward_settings_on_issuance(
  p_reward_setting_revision_id uuid,p_first_issued_at timestamptz,p_source_type text,p_source_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.live_reward_setting_revisions where id=p_reward_setting_revision_id and lifecycle_status='published')
  then raise exception 'published reward revision is required'; end if;
  insert into public.live_reward_setting_issuance_freezes values(p_reward_setting_revision_id,p_first_issued_at,btrim(p_source_type),p_source_id)
  on conflict (reward_setting_revision_id) do nothing;
end;
$$;

create function public.get_admin_live_reward_settings(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_live_event_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select coalesce(jsonb_agg(jsonb_build_object(
    'liveEventId',l.id,'effectiveStatus',public.live_effective_status_at(l.id,now()),
    'revisionId',selected.id,'revision',selected.revision,'status',selected.lifecycle_status,
    'policyVersion',selected.policy_version,'missionScore',selected.mission_score,
    'missionTicket',selected.mission_ticket,'journeyBonusTicket',selected.journey_bonus_ticket,
    'configuredLiveScoreMaximum', 1 + 3 + selected.mission_score,
    'projectedLiveTicketMaximum', 1 + 2 + selected.mission_ticket + selected.journey_bonus_ticket,
    'passportVerificationTicket', 1,'passportKnowledgeScoreIncluded',false,
    'missionTicketIssuanceDeferred',true
  ) order by l.created_at desc),'[]'::jsonb) into result
  from public.live_events l join lateral (
    select r.* from public.live_reward_setting_revisions r where r.live_event_id=l.id
    order by r.revision desc limit 1
  ) selected on true where p_live_event_id is null or l.id=p_live_event_id;
  return result;
end;
$$;

alter table public.live_reward_setting_revisions enable row level security;
alter table public.live_reward_setting_revisions force row level security;
alter table public.live_survey_reward_setting_bindings enable row level security;
alter table public.live_survey_reward_setting_bindings force row level security;
alter table public.live_reward_setting_issuance_freezes enable row level security;
alter table public.live_reward_setting_issuance_freezes force row level security;

revoke all on table public.live_reward_setting_revisions,public.live_survey_reward_setting_bindings,
  public.live_reward_setting_issuance_freezes from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.live_reward_setting_revisions,
  public.live_survey_reward_setting_bindings,public.live_reward_setting_issuance_freezes from service_role;
revoke all on function public.save_admin_live_reward_settings(uuid,uuid,uuid,uuid,integer,integer,integer,integer),
  public.publish_admin_live_reward_settings(uuid,uuid,uuid,uuid,integer),
  public.get_admin_live_reward_settings(uuid,uuid,uuid),public.bind_live_survey_reward_settings(uuid,uuid),
  public.freeze_live_reward_settings_on_issuance(uuid,timestamptz,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.validate_fan_ticket_reward_setting_identity()
  from public,anon,authenticated,service_role;
grant execute on function public.save_admin_live_reward_settings(uuid,uuid,uuid,uuid,integer,integer,integer,integer),
  public.publish_admin_live_reward_settings(uuid,uuid,uuid,uuid,integer),
  public.get_admin_live_reward_settings(uuid,uuid,uuid) to service_role;
