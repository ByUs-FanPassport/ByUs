#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${BYUS_COMMUNITY_STAMP_CONCURRENCY_MODE:-}" != "1" ]]; then
  BYUS_CLEAN_DB_PORT="${BYUS_CLEAN_DB_PORT:-55484}" \
  BYUS_COMMUNITY_STAMP_CONCURRENCY_MODE=1 \
  BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-community-stamp-concurrency.sh" \
    bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
  exit 0
fi

: "${PGHOST:?PGHOST is required in assertion mode}"
: "${PGPORT:?PGPORT is required in assertion mode}"
: "${PGDATABASE:?PGDATABASE is required in assertion mode}"
if [[ "$PGDATABASE" != "byus_clean" || "$PGHOST" != /*/byus-clean-db.*/socket \
  || ! -d "$PGHOST" || ! -S "$PGHOST/.s.PGSQL.$PGPORT" ]]; then
  echo "Community stamp concurrency verification refuses non-disposable PostgreSQL targets" >&2
  exit 1
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE")
"${PSQL[@]}" <<'SQL' >/dev/null
insert into public.celebrities(
  id,slug,status,image_url,published_at,roles,primary_role)
values(
  'f9130000-0000-4000-8000-000000000001',
  'community-stamp-race','draft','/community-stamp-race.webp',
  null,'{artist}','idol');
insert into public.celebrity_localizations(
  celebrity_id,locale,name,summary,image_alt) values
  ('f9130000-0000-4000-8000-000000000001','ko','스탬프 경합','스탬프 경합 검증','스탬프 경합'),
  ('f9130000-0000-4000-8000-000000000001','en','Stamp race','Stamp concurrency verification','Stamp race');
update public.celebrities set status='published'
  where id='f9130000-0000-4000-8000-000000000001';

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('f9130000-0000-4000-8000-000000000011','did:privy:community-race-owner','community-race-owner@byus.test','active'),
  ('f9130000-0000-4000-8000-000000000012','did:privy:community-race-inviter-a','community-race-inviter-a@byus.test','active'),
  ('f9130000-0000-4000-8000-000000000013','did:privy:community-race-inviter-b','community-race-inviter-b@byus.test','active'),
  ('f9130000-0000-4000-8000-000000000014','did:privy:community-race-invitee','community-race-invitee@byus.test','active');

insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('f9130000-0000-4000-8000-000000000011',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0011','privy','embedded'),
  ('f9130000-0000-4000-8000-000000000012',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0012','privy','embedded'),
  ('f9130000-0000-4000-8000-000000000013',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0013','privy','embedded'),
  ('f9130000-0000-4000-8000-000000000014',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0014','privy','embedded');

create table public.community_stamp_concurrency_codes(
  label text primary key,
  code text not null unique
);
insert into public.community_stamp_concurrency_codes(label,code) values
  ('inviter-a',public.get_community_stamp_invite_code('f9130000-0000-4000-8000-000000000012')->>'code'),
  ('inviter-b',public.get_community_stamp_invite_code('f9130000-0000-4000-8000-000000000013')->>'code');
SQL

python3 - <<'PY'
import os
import subprocess
import time

base = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atq"]

def sql(statement: str) -> str:
    return subprocess.check_output(base + ["-c", statement], text=True).strip()

def start_holder(statement: str, marker: str):
    process = subprocess.Popen(
        base,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "PGAPPNAME": f"community-holder-{marker.lower()}"},
    )
    assert process.stdin and process.stdout
    process.stdin.write(f"begin;\n{statement}\n\\echo {marker}\n")
    process.stdin.flush()
    result = process.stdout.readline().strip()
    observed_marker = process.stdout.readline().strip()
    if observed_marker != marker:
        raise AssertionError(("holder did not reach marker", result, observed_marker, process.stderr.read()))
    return process, result

def start_racer(statement: str, app_name: str):
    return subprocess.Popen(
        base + ["-c", statement],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "PGAPPNAME": app_name},
    )

def wait_for_lock(process, app_name: str):
    deadline = time.monotonic() + 5
    while sql(
        "select count(*) from pg_catalog.pg_stat_activity "
        f"where application_name='{app_name}' and wait_event_type='Lock'"
    ) != "1":
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            raise AssertionError(("racer completed before overlapping lock was observed", stdout, stderr))
        if time.monotonic() > deadline:
            raise AssertionError("concurrent RPC did not enter a PostgreSQL lock wait")
        time.sleep(0.03)

def commit_holder(process):
    assert process.stdin
    process.stdin.write("commit;\n\\q\n")
    process.stdin.flush()
    if process.wait(timeout=5) != 0:
        raise AssertionError(process.stderr.read())

# The first check-in commits one award while the overlapping call waits on the
# same source lock and then returns the idempotent false result.
checkin = (
    "select public.check_in_community_stamp("
    "'f9130000-0000-4000-8000-000000000011','community-stamp-race')->>'awarded';"
)
holder, first = start_holder(checkin, "CHECKIN_HELD")
if first != "true":
    raise AssertionError(("first concurrent check-in did not award", first))
racer = start_racer(checkin, "community-checkin-racer")
wait_for_lock(racer, "community-checkin-racer")
commit_holder(holder)
stdout, stderr = racer.communicate(timeout=5)
if racer.returncode != 0 or stdout.strip() != "false":
    raise AssertionError(("second concurrent check-in was not idempotent", stdout, stderr))

# Two different inviter codes race for one invitee. The invitee row lock is
# shared by both paths, so only the first binding and its two stamps may commit.
code_a = sql("select code from public.community_stamp_concurrency_codes where label='inviter-a'")
code_b = sql("select code from public.community_stamp_concurrency_codes where label='inviter-b'")
redeem_a = (
    "select public.redeem_community_stamp_invite("
    f"'f9130000-0000-4000-8000-000000000014','{code_a}')->>'awarded';"
)
redeem_b = (
    "select public.redeem_community_stamp_invite("
    f"'f9130000-0000-4000-8000-000000000014','{code_b}')->>'awarded';"
)
holder, first = start_holder(redeem_a, "INVITE_HELD")
if first != "true":
    raise AssertionError(("first concurrent invite did not award", first))
racer = start_racer(redeem_b, "community-invite-racer")
wait_for_lock(racer, "community-invite-racer")
commit_holder(holder)
stdout, stderr = racer.communicate(timeout=5)
if racer.returncode == 0 or "COMMUNITY_STAMP_ALREADY_REDEEMED" not in stderr:
    raise AssertionError(("second inviter unexpectedly bound the same invitee", stdout, stderr))

print("Community stamp concurrent lock waits and RPC outcomes: PASS")
PY

"${PSQL[@]}" <<'SQL'
do $$
declare
  checkin_owner constant uuid:='f9130000-0000-4000-8000-000000000011';
  creator constant uuid:='f9130000-0000-4000-8000-000000000001';
  inviter_a constant uuid:='f9130000-0000-4000-8000-000000000012';
  inviter_b constant uuid:='f9130000-0000-4000-8000-000000000013';
  invitee constant uuid:='f9130000-0000-4000-8000-000000000014';
  redemption uuid;
begin
  if (select count(*) from public.community_stamps stamp
      where stamp.app_user_id=checkin_owner and stamp.celebrity_id=creator
        and stamp.kind='daily_checkin')<>1 then
    raise exception 'concurrent check-in created duplicate or missing stamps';
  end if;
  if (select count(*) from public.blockchain_jobs job
      join public.community_stamps stamp on stamp.blockchain_job_id=job.id
      where stamp.app_user_id=checkin_owner and stamp.celebrity_id=creator
        and stamp.kind='daily_checkin' and job.entity_type='community_stamp')<>1 then
    raise exception 'concurrent check-in created duplicate or missing jobs';
  end if;

  select row_data.id into redemption
    from public.community_stamp_invite_redemptions row_data
    where row_data.invitee_app_user_id=invitee;
  if redemption is null
    or (select count(*) from public.community_stamp_invite_redemptions row_data
      where row_data.invitee_app_user_id=invitee)<>1
    or (select inviter_app_user_id from public.community_stamp_invite_redemptions
      where id=redemption)<>inviter_a then
    raise exception 'concurrent invite did not preserve one immutable winner';
  end if;
  if (select count(*) from public.community_stamps stamp
      where stamp.kind='invite' and stamp.app_user_id in (inviter_a,invitee))<>2
    or exists(select 1 from public.community_stamps stamp
      where stamp.kind='invite' and stamp.app_user_id=inviter_b)
    or (select count(*) from public.blockchain_jobs job
      join public.community_stamps stamp on stamp.blockchain_job_id=job.id
      where stamp.kind='invite' and stamp.app_user_id in (inviter_a,inviter_b,invitee)
        and job.entity_type='community_stamp')<>2 then
    raise exception 'concurrent invite left duplicate, losing, or partial ledger state';
  end if;
end $$;
select jsonb_build_object(
  'checkinStamps',1,
  'checkinJobs',1,
  'inviteRedemptions',1,
  'inviteStamps',2,
  'inviteJobs',2,
  'status','PASS') as community_stamp_concurrency_result;
SQL
