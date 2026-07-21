-- ADM-007 Benefit CMS. Secrets stay in private tables and every administrative
-- mutation is performed by a service-role RPC which rechecks the active actor.

create type public.benefit_allocation_mode as enum ('direct_claim', 'application_selection');
create type public.benefit_application_status as enum ('submitted', 'selected', 'not_selected', 'cancelled');

alter table public.benefits
  add column allocation_mode public.benefit_allocation_mode not null default 'direct_claim',
  add column revision integer not null default 1,
  add constraint benefits_application_limit check (
    allocation_mode <> 'application_selection' or per_user_limit = 1
  );

create table public.benefit_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  passport_id uuid not null,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  idempotency_key uuid not null unique,
  status public.benefit_application_status not null default 'submitted',
  selection_claim_id uuid references public.benefit_claims(id) on delete restrict,
  decision_idempotency_key uuid unique,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (benefit_id, app_user_id),
  unique (id, benefit_id),
  foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports(id, app_user_id, celebrity_id) on delete restrict,
  constraint benefit_application_decision_shape check (
    (status in ('submitted','cancelled') and decided_at is null and decided_by_admin_allowlist_id is null and selection_claim_id is null and decision_idempotency_key is null)
    or (status = 'not_selected' and decided_at is not null and decided_by_admin_allowlist_id is not null and selection_claim_id is null and decision_idempotency_key is not null)
    or (status = 'selected' and decided_at is not null and decided_by_admin_allowlist_id is not null and selection_claim_id is not null and decision_idempotency_key is not null)
  )
);
create index benefit_applications_queue_idx on public.benefit_applications(benefit_id, status, submitted_at, id);

alter table public.benefit_claims add column benefit_application_id uuid;
alter table public.benefit_claims add constraint benefit_claim_application_fk
  foreign key (benefit_application_id, benefit_id)
  references public.benefit_applications(id, benefit_id) on delete restrict;
create unique index benefit_claim_application_once_idx on public.benefit_claims(benefit_application_id) where benefit_application_id is not null;

create table public.benefit_claim_usage_events (
  id bigint generated always as identity primary key,
  benefit_claim_id uuid not null references public.benefit_claims(id) on delete restrict,
  marked_by_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  used_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (benefit_claim_id)
);

create function public.reject_benefit_history_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'benefit history is append-only'; end $$;
create trigger benefit_applications_reject_update_delete before delete on public.benefit_applications
for each row execute function public.reject_benefit_history_mutation();
create trigger benefit_usage_reject_update_delete before update or delete on public.benefit_claim_usage_events
for each row execute function public.reject_benefit_history_mutation();
create trigger benefit_claims_reject_update_delete before update or delete on public.benefit_claims
for each row execute function public.reject_benefit_history_mutation();

create function public.enforce_application_bound_claim() returns trigger language plpgsql set search_path='' as $$
declare v_mode public.benefit_allocation_mode;
begin
 select allocation_mode into v_mode from public.benefits where id=new.benefit_id;
 if v_mode='application_selection' then
   if new.benefit_application_id is null or not exists(
     select 1 from public.benefit_applications a where a.id=new.benefit_application_id
       and a.benefit_id=new.benefit_id and a.app_user_id=new.app_user_id
       and a.passport_id=new.passport_id and a.celebrity_id=new.celebrity_id and a.status='submitted'
   ) then raise exception 'submitted application binding is required'; end if;
 elsif new.benefit_application_id is not null then raise exception 'direct claim cannot bind an application'; end if;
 return new;
end $$;
create trigger benefit_claims_application_binding before insert on public.benefit_claims
for each row execute function public.enforce_application_bound_claim();

create function public.assert_active_admin(p_app_user_id uuid, p_allowlist_id uuid, p_writable boolean default true)
returns public.admin_role language plpgsql stable security definer set search_path='' as $$
declare v_role public.admin_role;
begin
  select a.role into v_role from public.admin_allowlist a
  join public.app_users u on u.verified_email=a.email
  where a.id=p_allowlist_id and u.id=p_app_user_id and u.status='active' and a.active;
  if not found then raise exception 'active admin required'; end if;
  if p_writable and v_role='viewer' then raise exception 'viewer is read-only'; end if;
  return v_role;
end $$;

create function public.get_admin_benefit_manager(p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object(
    'benefits', coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'slug',b.slug,'celebrityId',b.celebrity_id,'publicationStatus',b.publication_status,
      'allocationMode',b.allocation_mode,'deliveryType',b.delivery_type,'claimOpensAt',b.claim_opens_at,
      'claimClosesAt',b.claim_closes_at,'stockLimit',b.stock_limit,'perUserLimit',b.per_user_limit,
      'minimumScore',b.minimum_score,'minimumLevel',b.minimum_level,'requiredStampType',b.required_stamp_type,
      'requiredActivityType',b.required_activity_type,'archivedAt',b.archived_at,'archiveReason',b.archive_reason,
      'revision',b.revision,'deliveryConfigured',v.benefit_id is not null or exists(select 1 from public.benefit_unique_codes c where c.benefit_id=b.id),
      'codeInventory',jsonb_build_object('total',(select count(*) from public.benefit_unique_codes c where c.benefit_id=b.id),'available',(select count(*) from public.benefit_unique_codes c where c.benefit_id=b.id and c.claimed_by_claim_id is null)),
      'localizations',jsonb_build_object('ko',jsonb_build_object('title',ko.title,'summary',ko.summary,'eligibilityLabel',ko.eligibility_label,'deliveryLabel',ko.delivery_label),'en',jsonb_build_object('title',en.title,'summary',en.summary,'eligibilityLabel',en.eligibility_label,'deliveryLabel',en.delivery_label)),
      'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'appUserId',a.app_user_id,'status',a.status,'submittedAt',a.submitted_at,'claimId',a.selection_claim_id) order by a.submitted_at,a.id) from public.benefit_applications a where a.benefit_id=b.id),'[]'::jsonb),
      'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'appUserId',c.app_user_id,'claimedAt',c.claimed_at,'usedAt',u.used_at) order by c.claimed_at desc,c.id desc) from public.benefit_claims c left join public.benefit_claim_usage_events u on u.benefit_claim_id=c.id where c.benefit_id=b.id),'[]'::jsonb)
    ) order by b.created_at desc,b.id desc) from public.benefits b
      left join public.benefit_localizations ko on ko.benefit_id=b.id and ko.locale='ko'
      left join public.benefit_localizations en on en.benefit_id=b.id and en.locale='en'
      left join public.benefit_delivery_vault v on v.benefit_id=b.id), '[]'::jsonb),
    'celebrities',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'status',c.status,'nameKo',ko.name,'nameEn',en.name) order by c.display_order,c.id) from public.celebrities c join public.celebrity_localizations ko on ko.celebrity_id=c.id and ko.locale='ko' join public.celebrity_localizations en on en.celebrity_id=c.id and en.locale='en'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create function public.save_admin_benefit_draft(
 p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_benefit_id uuid,p_expected_revision integer,
 p_slug text,p_celebrity_id uuid,p_allocation_mode public.benefit_allocation_mode,p_delivery_type public.benefit_delivery_type,
 p_claim_opens_at timestamptz,p_claim_closes_at timestamptz,p_stock_limit integer,p_per_user_limit integer,p_minimum_score integer,p_minimum_level text,p_required_stamp_type text,p_required_activity_type public.fan_activity_type,
 p_title_ko text,p_summary_ko text,p_eligibility_ko text,p_delivery_ko text,p_title_en text,p_summary_en text,p_eligibility_en text,p_delivery_en text,p_delivery_secret text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_benefit_id,extensions.gen_random_uuid()); v_before jsonb; v_revision integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 if p_claim_opens_at>=p_claim_closes_at then raise exception 'invalid claim window'; end if;
 if p_allocation_mode='application_selection' and p_per_user_limit<>1 then raise exception 'application selection requires per-user limit 1'; end if;
 if p_benefit_id is not null then
   select to_jsonb(b),b.revision into v_before,v_revision from public.benefits b where b.id=p_benefit_id for update;
   if not found then raise exception 'benefit not found'; end if;
   if (v_before->>'archived_at') is not null or v_before->>'publication_status'<>'draft' then raise exception 'benefit is immutable'; end if;
   if p_expected_revision is null or v_revision<>p_expected_revision then raise exception 'benefit revision conflict'; end if;
   if v_before->>'delivery_type'='unique_code' and p_delivery_type<>'unique_code'
      and exists(select 1 from public.benefit_unique_codes where benefit_id=v_id) then
     raise exception 'clear unique-code inventory before changing delivery type';
   end if;
   update public.benefits set slug=p_slug,celebrity_id=p_celebrity_id,allocation_mode=p_allocation_mode,delivery_type=p_delivery_type,claim_opens_at=p_claim_opens_at,claim_closes_at=p_claim_closes_at,stock_limit=p_stock_limit,per_user_limit=p_per_user_limit,minimum_score=p_minimum_score,minimum_level=p_minimum_level,required_stamp_type=p_required_stamp_type,required_activity_type=p_required_activity_type,revision=revision+1 where id=v_id;
 else
   insert into public.benefits(id,slug,celebrity_id,allocation_mode,delivery_type,claim_opens_at,claim_closes_at,stock_limit,per_user_limit,minimum_score,minimum_level,required_stamp_type,required_activity_type) values(v_id,p_slug,p_celebrity_id,p_allocation_mode,p_delivery_type,p_claim_opens_at,p_claim_closes_at,p_stock_limit,p_per_user_limit,p_minimum_score,p_minimum_level,p_required_stamp_type,p_required_activity_type);
 end if;
 insert into public.benefit_localizations(benefit_id,locale,title,summary,eligibility_label,delivery_label) values
 (v_id,'ko',p_title_ko,p_summary_ko,p_eligibility_ko,p_delivery_ko),(v_id,'en',p_title_en,p_summary_en,p_eligibility_en,p_delivery_en)
 on conflict(benefit_id,locale) do update set title=excluded.title,summary=excluded.summary,eligibility_label=excluded.eligibility_label,delivery_label=excluded.delivery_label;
 if p_delivery_type<>'unique_code' and p_delivery_secret is not null then
   insert into public.benefit_delivery_vault(benefit_id,delivery_type,secret_value) values(v_id,p_delivery_type,p_delivery_secret)
   on conflict(benefit_id) do update set delivery_type=excluded.delivery_type,secret_value=excluded.secret_value;
 elsif p_delivery_type='unique_code' then delete from public.benefit_delivery_vault where benefit_id=v_id; end if;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
 values(p_actor_app_user_id,p_actor_admin_allowlist_id,case when p_benefit_id is null then 'benefit.created' else 'benefit.updated' end,'benefit',v_id::text,p_correlation_id,jsonb_build_object('before',v_before,'after',jsonb_build_object('slug',p_slug,'allocationMode',p_allocation_mode,'deliveryType',p_delivery_type)));
 return v_id;
end $$;

create function public.upload_admin_benefit_codes(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_benefit_id uuid,p_expected_revision integer,p_codes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_added integer; v_input integer; v_revision integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 select revision into v_revision from public.benefits where id=p_benefit_id and publication_status='draft' and archived_at is null and delivery_type='unique_code' for update;
 if not found then raise exception 'code inventory is immutable'; end if;
 if v_revision<>p_expected_revision then raise exception 'benefit revision conflict'; end if;
 if cardinality(p_codes)>10000 then raise exception 'too many codes'; end if;
 select count(*) into v_input from (select distinct trim(x) code from unnest(p_codes)x where length(trim(x)) between 1 and 500)s;
 insert into public.benefit_unique_codes(benefit_id,code_value) select p_benefit_id,s.code from (select distinct trim(x) code from unnest(p_codes)x where length(trim(x)) between 1 and 500)s on conflict do nothing;
 get diagnostics v_added=row_count;
 if v_added>0 then update public.benefits set revision=revision+1 where id=p_benefit_id; end if;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit.codes_uploaded','benefit',p_benefit_id::text,p_correlation_id,jsonb_build_object('validUniqueCount',v_input,'addedCount',v_added,'duplicateCount',v_input-v_added));
 return jsonb_build_object('validUniqueCount',v_input,'addedCount',v_added,'duplicateCount',v_input-v_added);
end $$;

create function public.clear_admin_benefit_codes(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_benefit_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_removed integer; v_revision integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 select revision into v_revision from public.benefits where id=p_benefit_id and publication_status='draft' and archived_at is null and delivery_type='unique_code' for update;
 if not found then raise exception 'code inventory is immutable'; end if;
 if v_revision<>p_expected_revision then raise exception 'benefit revision conflict'; end if;
 if exists(select 1 from public.benefit_unique_codes where benefit_id=p_benefit_id and claimed_by_claim_id is not null) then raise exception 'claimed code inventory cannot be cleared'; end if;
 delete from public.benefit_unique_codes where benefit_id=p_benefit_id; get diagnostics v_removed=row_count;
 update public.benefits set revision=revision+1 where id=p_benefit_id;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit.codes_cleared','benefit',p_benefit_id::text,p_correlation_id,jsonb_build_object('removedCount',v_removed));
 return jsonb_build_object('removedCount',v_removed);
end $$;

create function public.set_admin_benefit_state(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_benefit_id uuid,p_expected_revision integer,p_action text,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_revision integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 select to_jsonb(b),b.revision into v_before,v_revision from public.benefits b where id=p_benefit_id for update;
 if not found then raise exception 'benefit not found'; end if;
 if p_expected_revision is null or v_revision<>p_expected_revision then raise exception 'benefit revision conflict'; end if;
 if v_before->>'archived_at' is not null then raise exception 'benefit archived'; end if;
 if p_action='publish' then update public.benefits set publication_status='published',revision=revision+1 where id=p_benefit_id;
 elsif p_action='unpublish' then
   if exists(select 1 from public.benefit_claims where benefit_id=p_benefit_id) or exists(select 1 from public.benefit_applications where benefit_id=p_benefit_id) then raise exception 'benefit has immutable history'; end if;
   update public.benefits set publication_status='draft',revision=revision+1 where id=p_benefit_id;
 elsif p_action='archive' then
   if length(trim(coalesce(p_reason,'')))<10 then raise exception 'archive reason required'; end if;
   update public.benefits set publication_status='draft',archived_at=now(),archived_by_admin_allowlist_id=p_actor_admin_allowlist_id,archive_reason=trim(p_reason),revision=revision+1 where id=p_benefit_id;
 else raise exception 'invalid benefit action'; end if;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit.'||p_action,'benefit',p_benefit_id::text,p_correlation_id,jsonb_build_object('from',v_before->>'publication_status','reason',p_reason));
end $$;

create function public.assert_benefit_application_eligibility(p_benefit_id uuid,p_app_user_id uuid)
returns public.fan_passports language plpgsql security definer set search_path='' as $$
declare b public.benefits%rowtype; p public.fan_passports%rowtype; v_score integer; v_rank integer; v_required integer;
begin
 select * into b from public.benefits where id=p_benefit_id;
 select * into p from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and business_status='issued';
 if not found then raise exception 'eligible fan passport required'; end if;
 select coalesce(sum(points),0)::integer into v_score from public.fan_score_ledger where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id;
 v_rank:=case when v_score>=35 then 5 when v_score>=20 then 4 when v_score>=10 then 3 when v_score>=5 then 2 else 1 end;
 v_required:=case b.minimum_level when 'Diamond' then 5 when 'Platinum' then 4 when 'Gold' then 3 when 'Silver' then 2 else 1 end;
 if v_score<b.minimum_score or v_rank<v_required then raise exception 'benefit score or level requirement is not met'; end if;
 if b.required_stamp_type is not null and not exists(select 1 from public.stamps where passport_id=p.id and app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and stamp_type=b.required_stamp_type) then raise exception 'required stamp is missing'; end if;
 if b.required_activity_type is not null and not exists(select 1 from public.fan_activities where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and activity_type=b.required_activity_type) then raise exception 'required activity is missing'; end if;
 return p;
end $$;

create function public.submit_benefit_application(p_benefit_id uuid,p_app_user_id uuid,p_idempotency_key uuid,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.benefits%rowtype; p public.fan_passports%rowtype; a public.benefit_applications%rowtype;
begin
 select * into a from public.benefit_applications where idempotency_key=p_idempotency_key;
 if found then
  if a.benefit_id<>p_benefit_id or a.app_user_id<>p_app_user_id then raise exception 'idempotency key mismatch'; end if;
  return jsonb_build_object('applicationId',a.id,'status',a.status,'replayed',true);
 end if;
 select * into b from public.benefits where id=p_benefit_id for update;
 if not found or b.publication_status<>'published' or b.archived_at is not null or b.allocation_mode<>'application_selection' then raise exception 'application benefit unavailable'; end if;
 if b.per_user_limit<>1 then raise exception 'application selection requires per-user limit 1'; end if;
 if p_now<b.claim_opens_at or p_now>=b.claim_closes_at then raise exception 'application window closed'; end if;
 p:=public.assert_benefit_application_eligibility(b.id,p_app_user_id);
 insert into public.benefit_applications(benefit_id,app_user_id,passport_id,celebrity_id,idempotency_key,submitted_at) values(b.id,p_app_user_id,p.id,b.celebrity_id,p_idempotency_key,p_now) returning * into a;
 return jsonb_build_object('applicationId',a.id,'status',a.status,'replayed',false);
exception when unique_violation then
 select * into a from public.benefit_applications where idempotency_key=p_idempotency_key;
 if found then
   if a.benefit_id<>p_benefit_id or a.app_user_id<>p_app_user_id then raise exception 'idempotency key belongs to a different application'; end if;
   return jsonb_build_object('applicationId',a.id,'status',a.status,'replayed',true);
 end if;
 if exists(select 1 from public.benefit_applications where benefit_id=p_benefit_id and app_user_id=p_app_user_id) then raise exception 'fan already applied with a different idempotency key'; end if;
 raise;
end $$;

create function public.decide_admin_benefit_application(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_application_id uuid,p_selected boolean,p_idempotency_key uuid,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.benefit_applications%rowtype; b public.benefits%rowtype; existing public.benefit_claims%rowtype; claim_id uuid; code public.benefit_unique_codes%rowtype; v_total integer;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 select * into a from public.benefit_applications where id=p_application_id for update;
 if not found then raise exception 'application not found'; end if;
 if a.status<>'submitted' then
   if a.status='selected' and p_selected then
     select * into existing from public.benefit_claims where id=a.selection_claim_id;
     if existing.idempotency_key<>p_idempotency_key then raise exception 'selection idempotency key mismatch'; end if;
     return jsonb_build_object('applicationId',a.id,'status',a.status,'claimId',a.selection_claim_id,'replayed',true);
   elsif a.status='not_selected' and not p_selected then
     if a.decision_idempotency_key<>p_idempotency_key then raise exception 'selection idempotency key mismatch'; end if;
     return jsonb_build_object('applicationId',a.id,'status',a.status,'claimId',null,'replayed',true); end if;
   raise exception 'application already decided';
 end if;
 select * into b from public.benefits where id=a.benefit_id for update;
 if b.archived_at is not null or b.allocation_mode<>'application_selection' then raise exception 'benefit unavailable'; end if;
 if p_selected then
   claim_id:=extensions.gen_random_uuid();
   select * into existing from public.benefit_claims where idempotency_key=p_idempotency_key;
   if found then
     if existing.benefit_id<>a.benefit_id or existing.app_user_id<>a.app_user_id then raise exception 'idempotency key belongs to a different claim'; end if;
     raise exception 'idempotency key belongs to another selection';
   end if;
   perform public.assert_benefit_application_eligibility(b.id,a.app_user_id);
   select count(*)::integer into v_total from public.benefit_claims where benefit_id=b.id;
   if b.stock_limit is not null and v_total>=b.stock_limit then raise exception 'benefit stock is exhausted'; end if;
   if b.delivery_type='unique_code' then
     select * into code from public.benefit_unique_codes where benefit_id=b.id and claimed_by_claim_id is null order by created_at,id for update skip locked limit 1;
     if not found then raise exception 'benefit code inventory is exhausted'; end if;
   elsif not exists(select 1 from public.benefit_delivery_vault where benefit_id=b.id and delivery_type=b.delivery_type) then raise exception 'benefit delivery is not configured'; end if;
   insert into public.benefit_claims(id,benefit_id,app_user_id,celebrity_id,passport_id,idempotency_key,delivery_type,unique_code_id,benefit_application_id,claimed_at)
   values(claim_id,b.id,a.app_user_id,a.celebrity_id,a.passport_id,p_idempotency_key,b.delivery_type,case when b.delivery_type='unique_code' then code.id end,a.id,p_now);
   if b.delivery_type='unique_code' then update public.benefit_unique_codes set claimed_by_claim_id=claim_id where id=code.id and claimed_by_claim_id is null; if not found then raise exception 'unique code allocation conflict'; end if; end if;
   insert into public.benefit_claim_audits(benefit_claim_id,benefit_id,app_user_id,event_type,eligibility_snapshot) values(claim_id,b.id,a.app_user_id,'claimed',jsonb_build_object('applicationId',a.id,'allocationMode','application_selection'));
   update public.benefit_applications set status='selected',selection_claim_id=claim_id,decision_idempotency_key=p_idempotency_key,decided_at=p_now,decided_by_admin_allowlist_id=p_actor_admin_allowlist_id where id=a.id;
 else update public.benefit_applications set status='not_selected',decision_idempotency_key=p_idempotency_key,decided_at=p_now,decided_by_admin_allowlist_id=p_actor_admin_allowlist_id where id=a.id; end if;
 insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,case when p_selected then 'benefit.application_selected' else 'benefit.application_not_selected' end,'benefit_application',a.id::text,p_correlation_id,jsonb_build_object('benefitId',a.benefit_id,'claimId',claim_id));
 return jsonb_build_object('applicationId',a.id,'status',case when p_selected then 'selected' else 'not_selected' end,'claimId',claim_id,'replayed',false);
end $$;

create function public.mark_admin_benefit_claim_used(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_claim_id uuid,p_used_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.benefit_claim_usage_events%rowtype; v_inserted boolean:=false;
begin
 perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
 if p_used_at is null or p_used_at>now() then raise exception 'invalid benefit use timestamp'; end if;
 if not exists(select 1 from public.benefit_claims where id=p_claim_id and claimed_at<=p_used_at) then raise exception 'use timestamp must follow claim'; end if;
 insert into public.benefit_claim_usage_events(benefit_claim_id,marked_by_admin_allowlist_id,correlation_id,used_at) values(p_claim_id,p_actor_admin_allowlist_id,p_correlation_id,p_used_at) on conflict(benefit_claim_id) do nothing returning * into v;
 if found then v_inserted:=true; else select * into v from public.benefit_claim_usage_events where benefit_claim_id=p_claim_id; end if;
 if v_inserted then insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary) values(p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit.claim_used','benefit_claim',p_claim_id::text,p_correlation_id,jsonb_build_object('usedAt',v.used_at)); end if;
 return jsonb_build_object('claimId',p_claim_id,'usedAt',v.used_at);
end $$;

alter table public.benefit_applications enable row level security;
alter table public.benefit_claim_usage_events enable row level security;
revoke all on public.benefit_applications,public.benefit_claim_usage_events from public,anon,authenticated;
revoke insert,update,delete on public.benefit_applications from service_role;
grant select on public.benefit_applications to service_role;
grant select,insert on public.benefit_claim_usage_events to service_role;
grant execute on function public.get_admin_benefit_manager(uuid,uuid),public.save_admin_benefit_draft(uuid,uuid,uuid,uuid,integer,text,uuid,public.benefit_allocation_mode,public.benefit_delivery_type,timestamptz,timestamptz,integer,integer,integer,text,text,public.fan_activity_type,text,text,text,text,text,text,text,text,text),public.upload_admin_benefit_codes(uuid,uuid,uuid,uuid,integer,text[]),public.clear_admin_benefit_codes(uuid,uuid,uuid,uuid,integer),public.set_admin_benefit_state(uuid,uuid,uuid,uuid,integer,text,text),public.submit_benefit_application(uuid,uuid,uuid,timestamptz),public.decide_admin_benefit_application(uuid,uuid,uuid,uuid,boolean,uuid,timestamptz),public.mark_admin_benefit_claim_used(uuid,uuid,uuid,uuid,timestamptz) to service_role;
revoke all on function public.get_admin_benefit_manager(uuid,uuid),public.save_admin_benefit_draft(uuid,uuid,uuid,uuid,integer,text,uuid,public.benefit_allocation_mode,public.benefit_delivery_type,timestamptz,timestamptz,integer,integer,integer,text,text,public.fan_activity_type,text,text,text,text,text,text,text,text,text),public.upload_admin_benefit_codes(uuid,uuid,uuid,uuid,integer,text[]),public.clear_admin_benefit_codes(uuid,uuid,uuid,uuid,integer),public.set_admin_benefit_state(uuid,uuid,uuid,uuid,integer,text,text),public.submit_benefit_application(uuid,uuid,uuid,timestamptz),public.decide_admin_benefit_application(uuid,uuid,uuid,uuid,boolean,uuid,timestamptz),public.mark_admin_benefit_claim_used(uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
