#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${BYUS_MEMBERSHIP_ASSERTION_MODE:-}" != "1" ]]; then
  BYUS_CLEAN_DB_PORT="${BYUS_CLEAN_DB_PORT:-55441}" \
  BYUS_MEMBERSHIP_ASSERTION_MODE=1 \
  BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-membership-local.sh" \
    bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
  exit 0
fi

: "${PGHOST:?PGHOST is required in assertion mode}"
: "${PGPORT:?PGPORT is required in assertion mode}"
: "${PGDATABASE:?PGDATABASE is required in assertion mode}"
if [[ ! -d "$PGHOST" || ! -S "$PGHOST/.s.PGSQL.$PGPORT" || "$PGDATABASE" != "byus_clean" ]]; then
  echo "Membership verification refuses non-local or non-disposable PostgreSQL targets" >&2
  exit 1
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE")
"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/fan_certifications.sql"
"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/fan_membership_certifications.sql"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/byus-membership-concurrency.XXXXXX")"
cleanup() {
  find "$WORK_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Committed fixtures are needed because each concurrent psql process has its own
# transaction. The enclosing clean-replay script destroys this database on exit.
"${PSQL[@]}" <<'SQL' >/dev/null
create table public.certification_test_ids(name text primary key,id uuid not null);
insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('e1000000-0000-4000-8000-000000000001','did:privy:membership-race-owner','membership-race-owner@byus.test','active'),
  ('e1000000-0000-4000-8000-000000000002','did:privy:membership-race-admin','membership-race-admin@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('e1000000-0000-4000-8000-000000000010','membership-race-admin@byus.test','admin',true);
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('e1000000-0000-4000-8000-000000000001',91342,'0xe100000000000000000000000000000000000001','privy','embedded');
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('e1100000-0000-4000-8000-000000000001','membership-race','draft','/membership-race.webp',null,'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('e1100000-0000-4000-8000-000000000001','ko','멤버십 경합','멤버십 경합','멤버십 경합'),
  ('e1100000-0000-4000-8000-000000000001','en','Membership Race','Membership Race','Membership Race');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',1,'draft',null);
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('e1200000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001',1,'e1200000-0000-4000-8000-000000000021','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('e1200000-0000-4000-8000-000000000031','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000011');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('e1200000-0000-4000-8000-000000000041','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000031');

do $$
declare saved jsonb; mission uuid; submitted jsonb;
begin
  saved:=public.save_admin_certification_mission_v2(
    'e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000010','e1300000-0000-4000-8000-000000000001',
    null,'e1100000-0000-4000-8000-000000000001','membership-race-youtube',null,'멤버십','동시 심사','Concurrent review','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'youtube');
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000010','e1300000-0000-4000-8000-000000000002',mission,1,'active');
  perform public.register_owned_certification_upload('e1000000-0000-4000-8000-000000000001',mission,'e1400000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001/'||mission||'/e1400000-0000-4000-8000-000000000001.webp',100,10,10,repeat('a',64));
  perform public.register_owned_certification_upload('e1000000-0000-4000-8000-000000000001',mission,'e1400000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001/'||mission||'/e1400000-0000-4000-8000-000000000002.webp',100,10,10,repeat('b',64));
  submitted:=public.submit_owned_certification('e1000000-0000-4000-8000-000000000001',mission,'e1500000-0000-4000-8000-000000000001','["e1400000-0000-4000-8000-000000000001"]',null,null);
  insert into public.certification_test_ids(name,id) values('approve_approve',(submitted->>'id')::uuid);
end $$;
SQL

run_review() {
  local output_file="$1" idempotency_key="$2" decision="$3" reason="$4" submission_name="$5"
  "${PSQL[@]}" -v idempotency_key="$idempotency_key" -v decision="$decision" -v reason="$reason" -v submission_name="$submission_name" >"$output_file" 2>&1 <<'SQL'
select public.review_admin_certification_submission(
  'e1000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000010',
  extensions.gen_random_uuid(),
  (select id from public.certification_test_ids where name=:'submission_name'),
  :'idempotency_key',1,:'decision',nullif(:'reason',''));
SQL
}

run_review "$WORK_DIR/approve-a.log" e1500000-0000-4000-8000-000000000011 approve '' approve_approve & pid_a=$!
run_review "$WORK_DIR/approve-b.log" e1500000-0000-4000-8000-000000000012 approve '' approve_approve & pid_b=$!
status_a=0; status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  cat "$WORK_DIR/approve-a.log" "$WORK_DIR/approve-b.log" >&2
  echo "approve/approve race did not produce exactly one winner" >&2
  exit 1
fi
if ! cat "$WORK_DIR/approve-a.log" "$WORK_DIR/approve-b.log" | grep -q 'CERTIFICATION_STALE_REVISION'; then
  cat "$WORK_DIR/approve-a.log" "$WORK_DIR/approve-b.log" >&2
  echo "approve/approve race loser did not report stale revision" >&2
  exit 1
fi

"${PSQL[@]}" <<'SQL' >/dev/null
do $$ declare submission uuid:=(select id from public.certification_test_ids where name='approve_approve'); begin
  if (select status from public.certification_submissions where id=submission)<>'approved'
    or (select count(*) from public.fan_activities where source_id=submission and activity_type='membership')<>1
    or (select count(*) from public.fan_score_ledger where manual_submission_id=submission)<>1
    or (select count(*) from public.stamps s join public.fan_activities a on a.id=s.activity_id where a.source_id=submission and s.stamp_type='membership')<>1
    or (select count(*) from public.blockchain_jobs j join public.stamps s on s.blockchain_job_id=j.id join public.fan_activities a on a.id=s.activity_id where a.source_id=submission)<>1
    or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=submission) then
    raise exception 'approve/approve race produced duplicate or partial rewards';
  end if;
end $$;
SQL

# A second creator avoids the deliberate once-per-owner/creator/platform rule.
"${PSQL[@]}" <<'SQL' >/dev/null
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('e1100000-0000-4000-8000-000000000002','membership-race-two','draft','/membership-race-two.webp',null,'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('e1100000-0000-4000-8000-000000000002','ko','멤버십 경합 2','멤버십 경합 2','멤버십 경합 2'),
  ('e1100000-0000-4000-8000-000000000002','en','Membership Race 2','Membership Race 2','Membership Race 2');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000002',1,'draft',null);
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('e1200000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000002',1,'e1200000-0000-4000-8000-000000000022','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('e1200000-0000-4000-8000-000000000032','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000012');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('e1200000-0000-4000-8000-000000000042','e1000000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000032');
do $$ declare saved jsonb; mission uuid; submitted jsonb; begin
  saved:=public.save_admin_certification_mission_v2('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000010','e1300000-0000-4000-8000-000000000011',null,'e1100000-0000-4000-8000-000000000002','membership-race-two-youtube',null,'멤버십','승인 반려 경합','Approve reject race','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'youtube');
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000010','e1300000-0000-4000-8000-000000000012',mission,1,'active');
  perform public.register_owned_certification_upload('e1000000-0000-4000-8000-000000000001',mission,'e1400000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000001/'||mission||'/e1400000-0000-4000-8000-000000000012.webp',100,10,10,repeat('d',64));
  submitted:=public.submit_owned_certification('e1000000-0000-4000-8000-000000000001',mission,'e1500000-0000-4000-8000-000000000021','["e1400000-0000-4000-8000-000000000012"]',null,null);
  insert into public.certification_test_ids(name,id) values('approve_reject',(submitted->>'id')::uuid);
end $$;
SQL

run_review "$WORK_DIR/mixed-approve.log" e1500000-0000-4000-8000-000000000022 approve '' approve_reject & pid_a=$!
run_review "$WORK_DIR/mixed-reject.log" e1500000-0000-4000-8000-000000000023 reject '보완 자료가 필요합니다.' approve_reject & pid_b=$!
status_a=0; status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  cat "$WORK_DIR/mixed-approve.log" "$WORK_DIR/mixed-reject.log" >&2
  echo "approve/reject race did not produce exactly one winner" >&2
  exit 1
fi
if ! cat "$WORK_DIR/mixed-approve.log" "$WORK_DIR/mixed-reject.log" | grep -q 'CERTIFICATION_STALE_REVISION'; then
  cat "$WORK_DIR/mixed-approve.log" "$WORK_DIR/mixed-reject.log" >&2
  echo "approve/reject race loser did not report stale revision" >&2
  exit 1
fi

"${PSQL[@]}" <<'SQL'
do $$ declare submission uuid:=(select id from public.certification_test_ids where name='approve_reject'); final_status public.certification_submission_status; begin
  select status into final_status from public.certification_submissions where id=submission;
  if final_status='approved' then
    if (select count(*) from public.fan_activities where source_id=submission and activity_type='membership')<>1
      or (select count(*) from public.fan_score_ledger where manual_submission_id=submission)<>1
      or (select count(*) from public.stamps s join public.fan_activities a on a.id=s.activity_id where a.source_id=submission and s.stamp_type='membership')<>1
      or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=submission) then
      raise exception 'approve/reject approval winner left invalid rewards';
    end if;
  elsif final_status='rejected' then
    if exists(select 1 from public.fan_activities where source_id=submission)
      or exists(select 1 from public.fan_score_ledger where manual_submission_id=submission)
      or exists(select 1 from public.stamps s join public.fan_activities a on a.id=s.activity_id where a.source_id=submission) then
      raise exception 'approve/reject rejection winner left rewards';
    end if;
  else
    raise exception 'approve/reject race left submission pending';
  end if;
end $$;
select 'fan membership certification concurrency verification passed' as result;
SQL
