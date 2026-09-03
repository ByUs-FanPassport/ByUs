#!/usr/bin/env bash
set -euo pipefail

owner_id="$(psql -X -Atqc "select id from public.app_users where privy_user_id='did:privy:collectible-owner'")"
psql -X -v ON_ERROR_STOP=1 -Atqc "select public.claim_owned_live_collectible('$owner_id','collectible-proof-6','60000000-0000-4000-8000-000000000001')" >"${TMPDIR:-/tmp}/byus-collectible-race-a.json" 2>"${TMPDIR:-/tmp}/byus-collectible-race-a.err" &
left=$!
psql -X -v ON_ERROR_STOP=1 -Atqc "select public.claim_owned_live_collectible('$owner_id','collectible-proof-6','60000000-0000-4000-8000-000000000002')" >"${TMPDIR:-/tmp}/byus-collectible-race-b.json" 2>"${TMPDIR:-/tmp}/byus-collectible-race-b.err" &
right=$!
left_status=0; right_status=0
wait "$left" || left_status=$?
wait "$right" || right_status=$?
if { [[ "$left_status" -eq 0 ]] && [[ "$right_status" -eq 0 ]]; } || { [[ "$left_status" -ne 0 ]] && [[ "$right_status" -ne 0 ]]; }; then
  echo "expected exactly one concurrent claim success" >&2
  exit 1
fi
if ! cat "${TMPDIR:-/tmp}/byus-collectible-race-a.err" "${TMPDIR:-/tmp}/byus-collectible-race-b.err" | grep -q 'P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT'; then
  echo "losing concurrent claim did not fail with the bounded-key conflict" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare target_live uuid; target_owner uuid;
begin
  select id into strict target_live from public.live_events where slug='collectible-proof-6';
  select id into strict target_owner from public.app_users where privy_user_id='did:privy:collectible-owner';
  if (select count(*) from public.live_collectible_claims where live_event_id=target_live and app_user_id=target_owner)<>1 then raise exception 'concurrent claim cardinality failed'; end if;
  if (select count(*) from public.blockchain_jobs job join public.live_collectible_claims claim on claim.blockchain_job_id=job.id where claim.live_event_id=target_live and claim.app_user_id=target_owner)<>1 then raise exception 'concurrent job cardinality failed'; end if;
  if (select count(*) from public.live_collectible_claim_idempotency where live_event_id=target_live and app_user_id=target_owner)<>1 then raise exception 'concurrent replay key cardinality failed'; end if;
end $$;
select jsonb_build_object('concurrentClaims',1,'concurrentJobs',1,'status','PASS') as collectible_concurrency_result;
SQL
rm -f "${TMPDIR:-/tmp}/byus-collectible-race-a.json" "${TMPDIR:-/tmp}/byus-collectible-race-b.json" \
  "${TMPDIR:-/tmp}/byus-collectible-race-a.err" "${TMPDIR:-/tmp}/byus-collectible-race-b.err"
