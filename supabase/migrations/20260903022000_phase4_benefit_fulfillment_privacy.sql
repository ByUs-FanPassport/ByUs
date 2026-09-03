-- Versioned fulfillment commands and the isolated recipient PII boundary.

alter table public.benefit_fulfillments add constraint benefit_fulfillment_method_status_shape check (
  (method='digital' and status in ('ready','digital_delivered'))
  or (method='physical_shipping' and status in ('information_required','ready','shipping_preparing','shipping_in_transit','shipping_completed'))
  or (method='on_site_pickup' and status in ('information_required','ready','pickup_available','pickup_completed'))
);

create table public.benefit_recipient_consent_versions (
  version text primary key check (length(trim(version)) between 1 and 100),
  active boolean not null default true,
  effective_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);
insert into public.benefit_recipient_consent_versions(version,active,effective_at)
values('2026-09-v1',true,'2026-09-01T00:00:00Z');
alter table public.benefit_recipient_consent_versions enable row level security;
alter table public.benefit_recipient_consent_versions force row level security;
revoke all on table public.benefit_recipient_consent_versions from public,anon,authenticated,service_role;

create function public.save_owned_benefit_recipient(
  p_app_user_id uuid,p_winner_id uuid,p_correlation_id uuid,
  p_consent_version text,p_consented boolean,p_name text,p_phone text,
  p_postal_code text default null,p_address1 text default null,p_address2 text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.benefit_fulfillments%rowtype;
begin
  select f.* into v from public.benefit_fulfillments f
    join public.benefit_draw_winners w on w.id=f.winner_id
    where f.winner_id=p_winner_id and w.app_user_id=p_app_user_id for update of f;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if v.method='digital' then raise exception 'PHASE4_RECIPIENT_NOT_REQUIRED'; end if;
  if v.status<>'information_required' then raise exception 'PHASE4_RECIPIENT_STATE_CONFLICT'; end if;
  if p_consented is distinct from true or not exists(
    select 1 from public.benefit_recipient_consent_versions c
    where c.version=p_consent_version and c.active and c.effective_at<=pg_catalog.statement_timestamp()
  ) then raise exception 'PHASE4_RECIPIENT_CONSENT_INVALID'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120
     or length(trim(coalesce(p_phone,''))) not between 7 and 40 then
    raise exception 'PHASE4_RECIPIENT_INVALID';
  end if;
  if v.method='physical_shipping' and (
    length(trim(coalesce(p_postal_code,''))) not between 1 and 20
    or length(trim(coalesce(p_address1,''))) not between 1 and 300
  ) then raise exception 'PHASE4_SHIPPING_ADDRESS_REQUIRED'; end if;

  insert into public.benefit_recipient_private(
    winner_id,consent_version,consented_at,name,phone,postal_code,address1,address2
  ) values(
    p_winner_id,p_consent_version,pg_catalog.statement_timestamp(),trim(p_name),trim(p_phone),
    nullif(trim(coalesce(p_postal_code,'')),''),nullif(trim(coalesce(p_address1,'')),''),
    nullif(trim(coalesce(p_address2,'')),'')
  ) on conflict(winner_id) do update set
    consent_version=excluded.consent_version,consented_at=excluded.consented_at,
    name=excluded.name,phone=excluded.phone,postal_code=excluded.postal_code,
    address1=excluded.address1,address2=excluded.address2;
  update public.benefit_fulfillments set status='ready',revision=revision+1 where id=v.id;
  insert into public.benefit_fulfillment_events(
    fulfillment_id,from_status,to_status,actor_app_user_id,correlation_id
  ) values(v.id,'information_required','ready',p_app_user_id,p_correlation_id);
  return jsonb_build_object('winnerId',p_winner_id,'method',v.method,'status','ready','revision',v.revision+1);
end;
$$;

create function public.mask_benefit_recipient_name(p_name text)
returns text language sql immutable strict set search_path='' as $$
  select case when char_length(p_name)=1 then '*' when char_length(p_name)=2 then left(p_name,1)||'*'
    else left(p_name,1)||repeat('*',char_length(p_name)-2)||right(p_name,1) end
$$;
create function public.mask_benefit_recipient_phone(p_phone text)
returns text language sql immutable strict set search_path='' as $$
  select case when length(regexp_replace(p_phone,'[^0-9]','','g'))>=7
    then left(regexp_replace(p_phone,'[^0-9]','','g'),3)||'-****-'||right(regexp_replace(p_phone,'[^0-9]','','g'),4)
    else '***-****' end
$$;

create function public.get_admin_benefit_winner(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_reveal boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role public.admin_role; v jsonb; v_exists boolean;
begin
  v_role:=public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_reveal and v_role='viewer' then raise exception 'PHASE4_RECIPIENT_REVEAL_FORBIDDEN'; end if;
  select exists(select 1 from public.benefit_draw_winners where id=p_winner_id) into v_exists;
  if not v_exists then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if p_reveal then
    insert into public.benefit_recipient_access_audits(
      winner_id,access_type,actor_app_user_id,actor_admin_allowlist_id,correlation_id
    ) values(p_winner_id,'revealed',p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id);
  end if;
  select jsonb_build_object(
    'winnerId',w.id,'benefitId',w.benefit_id,'appUserId',w.app_user_id,
    'method',f.method,'status',f.status,'revision',f.revision,
    'recipient',case when r.winner_id is null then null when p_reveal then jsonb_build_object(
      'name',r.name,'phone',r.phone,'postalCode',r.postal_code,'address1',r.address1,
      'address2',r.address2,'consentVersion',r.consent_version,'consentedAt',r.consented_at
    ) else jsonb_build_object(
      'name',public.mask_benefit_recipient_name(r.name),
      'phone',public.mask_benefit_recipient_phone(r.phone),'masked',true
    ) end
  ) into v from public.benefit_draw_winners w
    join public.benefit_fulfillments f on f.winner_id=w.id
    left join public.benefit_recipient_private r on r.winner_id=w.id
    where w.id=p_winner_id;
  return v;
end;
$$;

create function public.transition_admin_benefit_fulfillment(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_winner_id uuid,p_expected_revision integer,p_to_status public.benefit_fulfillment_status,
  p_carrier text default null,p_tracking_number text default null,p_operator_memo text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.benefit_fulfillments%rowtype; v_allowed boolean:=false;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into v from public.benefit_fulfillments where winner_id=p_winner_id for update;
  if not found then raise exception 'PHASE4_REWARD_WINNER_NOT_FOUND'; end if;
  if v.revision<>p_expected_revision then raise exception 'PHASE4_FULFILLMENT_REVISION_CONFLICT'; end if;
  v_allowed:=case v.method
    when 'digital' then v.status='ready' and p_to_status='digital_delivered'
    when 'physical_shipping' then (v.status,p_to_status) in (
      ('ready','shipping_preparing'),('shipping_preparing','shipping_in_transit'),
      ('shipping_in_transit','shipping_completed'))
    when 'on_site_pickup' then (v.status,p_to_status) in (
      ('ready','pickup_available'),('pickup_available','pickup_completed'))
    else false end;
  if not v_allowed then raise exception 'PHASE4_FULFILLMENT_TRANSITION_INVALID'; end if;
  if p_to_status='shipping_in_transit' and (
    length(trim(coalesce(p_carrier,'')))<1 or length(trim(coalesce(p_tracking_number,'')))<1
  ) then raise exception 'PHASE4_SHIPPING_TRACKING_REQUIRED'; end if;
  if length(trim(coalesce(p_operator_memo,''))) not between 10 and 1000 then
    raise exception 'PHASE4_FULFILLMENT_OPERATOR_MEMO_REQUIRED';
  end if;
  update public.benefit_fulfillments set status=p_to_status,revision=revision+1 where id=v.id;
  insert into public.benefit_fulfillment_events(
    fulfillment_id,from_status,to_status,carrier,tracking_number,operator_memo,
    actor_app_user_id,actor_admin_allowlist_id,correlation_id
  ) values(
    v.id,v.status,p_to_status,nullif(trim(coalesce(p_carrier,'')),''),
    nullif(trim(coalesce(p_tracking_number,'')),''),trim(p_operator_memo),
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id
  );
  return jsonb_build_object('winnerId',p_winner_id,'method',v.method,'status',p_to_status,'revision',v.revision+1);
end;
$$;

revoke all on function public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) from public,anon,authenticated;
revoke all on function public.mask_benefit_recipient_name(text) from public,anon,authenticated;
revoke all on function public.mask_benefit_recipient_phone(text) from public,anon,authenticated;
grant execute on function public.save_owned_benefit_recipient(uuid,uuid,uuid,text,boolean,text,text,text,text,text) to service_role;
grant execute on function public.get_admin_benefit_winner(uuid,uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.transition_admin_benefit_fulfillment(uuid,uuid,uuid,uuid,integer,public.benefit_fulfillment_status,text,text,text) to service_role;
