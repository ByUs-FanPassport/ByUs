-- Best-effort measurement projections from committed operational facts.
-- Any measurement failure is swallowed so analytics can never roll back business success.

create function public.project_committed_product_event_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_event text;
  v_owner uuid;
  v_celebrity uuid;
  v_live uuid;
  v_mission uuid;
  v_benefit uuid;
  v_id uuid;
  v_occurred timestamptz;
  v_properties jsonb := '{}'::jsonb;
begin
  if tg_table_name='fan_passports' then
    v_event:='passport_issued';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_id:=new.id;v_occurred:=new.issued_at;
  elsif tg_table_name='fan_reactions' then
    v_event:='reaction_completed';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_id:=new.id;v_occurred:=new.completed_at;v_properties:=jsonb_build_object('reactionId',new.id);
  elsif tg_table_name='live_reservations' then
    v_event:='reservation_completed';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_live:=new.live_event_id;v_id:=new.id;v_occurred:=new.reserved_at;
  elsif tg_table_name='live_attendances' then
    v_event:='attendance_completed';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_live:=new.live_event_id;v_id:=new.id;v_occurred:=new.attended_at;
  elsif tg_table_name='live_survey_responses' then
    if new.status::text<>'submitted' then return new;end if;
    v_event:='mission_completed';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_live:=new.live_event_id;v_mission:=new.survey_id;v_id:=new.id;v_occurred:=new.submitted_at;
  elsif tg_table_name='fan_ticket_ledger' then
    v_event:=case new.entry_kind when 'credit' then 'ticket_credited' else 'ticket_debited' end;
    v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_id:=new.id;v_occurred:=new.created_at;
    select coalesce(r.live_event_id,a.live_event_id,s.live_event_id,j.live_event_id)
      into v_live
      from (select 1) x
      left join public.live_reservations r on r.id=new.source_id
      left join public.live_attendances a on a.id=new.source_id
      left join public.live_survey_responses s on s.id=new.source_id
      left join public.live_journey_completions j on j.id=new.source_id;
    v_properties:=jsonb_build_object('ledgerRowId',new.id,'sourceType',new.source_type);
  elsif tg_table_name='live_journey_completions' then
    v_event:='journey_completed';v_owner:=new.app_user_id;v_live:=new.live_event_id;v_id:=new.id;v_occurred:=new.completed_at;
    select celebrity_id into v_celebrity from public.live_events where id=new.live_event_id;
  elsif tg_table_name='live_collectible_claims' then
    v_event:='collectible_claimed';v_owner:=new.app_user_id;v_live:=new.live_event_id;v_id:=new.id;v_occurred:=new.claimed_at;
    select celebrity_id into v_celebrity from public.live_events where id=new.live_event_id;
  elsif tg_table_name='benefit_claims' then
    v_event:='benefit_entered';v_owner:=new.app_user_id;v_celebrity:=new.celebrity_id;v_benefit:=new.benefit_id;v_id:=new.id;v_occurred:=new.claimed_at;
  elsif tg_table_name='benefit_ticket_entries' then
    v_event:='benefit_entered';v_owner:=new.app_user_id;v_benefit:=new.benefit_id;v_id:=new.id;v_occurred:=new.entered_at;
    select c.live_event_id,e.celebrity_id into v_live,v_celebrity from public.live_benefit_campaigns c join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;
  elsif tg_table_name='benefit_draw_winners' then
    v_event:='benefit_won';v_owner:=new.app_user_id;v_benefit:=new.benefit_id;v_id:=new.id;v_occurred:=new.selected_at;
    select c.live_event_id,e.celebrity_id into v_live,v_celebrity from public.live_benefit_campaigns c join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;
  elsif tg_table_name='benefit_fulfillment_events' then
    if new.to_status::text not in('shipping_completed','pickup_completed','digital_delivered') then return new;end if;
    v_event:='fulfillment_completed';v_id:=new.id;v_occurred:=new.created_at;
    select w.app_user_id,w.benefit_id,c.live_event_id,e.celebrity_id
      into v_owner,v_benefit,v_live,v_celebrity
      from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id
      join public.live_benefit_campaigns c on c.id=w.campaign_id join public.live_events e on e.id=c.live_event_id
      where f.id=new.fulfillment_id;
  else return new;
  end if;
  v_properties:=v_properties||jsonb_build_object('businessEntityId',v_id);
  begin
    perform public.record_product_event_v1(1,v_event,v_owner,null,v_celebrity,v_live,v_mission,v_benefit,
      'server.commit_projection','server:'||v_event||':'||v_id::text,v_occurred,v_properties);
  exception when others then
    raise warning 'product event projection skipped: % %',v_event,sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.project_committed_product_event_v1() from public,anon,authenticated,service_role;

create trigger fan_passports_product_event after insert on public.fan_passports for each row execute function public.project_committed_product_event_v1();
create trigger fan_reactions_product_event after insert on public.fan_reactions for each row execute function public.project_committed_product_event_v1();
create trigger live_reservations_product_event after insert on public.live_reservations for each row execute function public.project_committed_product_event_v1();
create trigger live_attendances_product_event after insert on public.live_attendances for each row execute function public.project_committed_product_event_v1();
create trigger live_survey_responses_product_event_insert after insert on public.live_survey_responses for each row when(new.status::text='submitted') execute function public.project_committed_product_event_v1();
create trigger live_survey_responses_product_event_update after update of status on public.live_survey_responses for each row when(old.status::text<>'submitted' and new.status::text='submitted') execute function public.project_committed_product_event_v1();
create trigger fan_ticket_ledger_product_event after insert on public.fan_ticket_ledger for each row execute function public.project_committed_product_event_v1();
create trigger live_journey_completions_product_event after insert on public.live_journey_completions for each row execute function public.project_committed_product_event_v1();
create trigger live_collectible_claims_product_event after insert on public.live_collectible_claims for each row execute function public.project_committed_product_event_v1();
create trigger benefit_claims_product_event after insert on public.benefit_claims for each row execute function public.project_committed_product_event_v1();
create trigger benefit_ticket_entries_product_event after insert on public.benefit_ticket_entries for each row execute function public.project_committed_product_event_v1();
create trigger benefit_draw_winners_product_event after insert on public.benefit_draw_winners for each row execute function public.project_committed_product_event_v1();
create trigger benefit_fulfillment_events_product_event after insert on public.benefit_fulfillment_events for each row execute function public.project_committed_product_event_v1();
