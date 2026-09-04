#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/byus-notification-email-conflict.XXXXXX")"
cleanup() {
  find "$ARTIFACT_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

call_sync() {
  local app_user_id="$1"
  local privy_user_id="$2"
  local email="$3"
  local now="$4"

  psql -X -v ON_ERROR_STOP=1 -Atq \
    --set=app_user_id="$app_user_id" \
    --set=privy_user_id="$privy_user_id" \
    --set=email="$email" \
    --set=now="$now" <<'SQL'
set role service_role;
select public.sync_owned_google_notification_channel(
  :'app_user_id'::uuid,
  :'privy_user_id',
  :'email',
  true,
  :'now'::timestamptz
);
SQL
}

expect_role_denied() {
  local role="$1"
  local stdout_file="$ARTIFACT_DIR/${role}.out"
  local stderr_file="$ARTIFACT_DIR/${role}.err"

  if psql -X -v ON_ERROR_STOP=1 -Atq >"$stdout_file" 2>"$stderr_file" <<SQL
set role $role;
select public.sync_owned_google_notification_channel(
  '51000000-0000-4000-8000-000000000001'::uuid,
  'did:privy:phase5-email-owner-a',
  'owner@example.test',
  true,
  '2026-09-04T00:00:00Z'::timestamptz
);
SQL
  then
    echo "$role unexpectedly executed sync_owned_google_notification_channel" >&2
    exit 1
  fi
  if ! grep -qi 'permission denied for function sync_owned_google_notification_channel' "$stderr_file"; then
    echo "$role denial did not come from the function privilege boundary" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
}

psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.app_users(id,privy_user_id,verified_email)
values
  ('51000000-0000-4000-8000-000000000001','did:privy:phase5-email-owner-a','shared-sequential@example.test'),
  ('51000000-0000-4000-8000-000000000002','did:privy:phase5-email-owner-b','shared-sequential@example.test'),
  ('51000000-0000-4000-8000-000000000003','did:privy:phase5-email-race-a','shared-race@example.test'),
  ('51000000-0000-4000-8000-000000000004','did:privy:phase5-email-race-b','shared-race@example.test');
SQL

# Deterministic behavior: a later canonical identity with the same verified
# email may finish login, but cannot receive or mutate the existing PII channel.
[[ "$(call_sync '51000000-0000-4000-8000-000000000001' 'did:privy:phase5-email-owner-a' ' Shared-Sequential@Example.Test ' '2026-09-04T00:00:00Z')" == "t" ]]
[[ "$(call_sync '51000000-0000-4000-8000-000000000002' 'did:privy:phase5-email-owner-b' 'shared-sequential@example.test' '2026-09-04T00:00:01Z')" == "t" ]]

psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare
  expected_fingerprint text := encode(extensions.digest('shared-sequential@example.test','sha256'),'hex');
begin
  if (select count(*) from public.fan_connected_accounts
      where app_user_id in (
        '51000000-0000-4000-8000-000000000001'::uuid,
        '51000000-0000-4000-8000-000000000002'::uuid
      ) and provider='google' and status='connected') <> 2 then
    raise exception 'duplicate email must not block either canonical login projection';
  end if;
  if (select count(*) from public.fan_notification_channels
      where kind='email' and destination_fingerprint=expected_fingerprint) <> 1 then
    raise exception 'duplicate email must retain exactly one notification channel';
  end if;
  if not exists (
    select 1 from public.fan_notification_channels channel
    where channel.kind='email'
      and channel.destination_fingerprint=expected_fingerprint
      and channel.app_user_id='51000000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'later duplicate-email login transferred channel ownership';
  end if;
  if exists (
    select 1 from public.fan_notification_channels
    where app_user_id='51000000-0000-4000-8000-000000000002'::uuid and kind='email'
  ) then
    raise exception 'later duplicate-email login created a second owner destination';
  end if;
  if (select private.destination
      from public.fan_notification_channels channel
      join public.fan_notification_channel_private private on private.channel_id=channel.id
      where channel.kind='email' and channel.destination_fingerprint=expected_fingerprint)
      <> 'shared-sequential@example.test' then
    raise exception 'later duplicate-email login changed the original raw destination';
  end if;
end $$;
SQL

expect_role_denied anon
expect_role_denied authenticated

# Concurrency behavior: start two different canonical identities against the
# same new fingerprint. Both calls must succeed, while the advisory lock and
# unique constraint leave one owner and one private destination.
call_sync '51000000-0000-4000-8000-000000000003' 'did:privy:phase5-email-race-a' \
  'shared-race@example.test' '2026-09-04T00:01:00Z' \
  >"$ARTIFACT_DIR/race-a.out" 2>"$ARTIFACT_DIR/race-a.err" &
race_a_pid=$!
call_sync '51000000-0000-4000-8000-000000000004' 'did:privy:phase5-email-race-b' \
  ' SHARED-RACE@EXAMPLE.TEST ' '2026-09-04T00:01:00Z' \
  >"$ARTIFACT_DIR/race-b.out" 2>"$ARTIFACT_DIR/race-b.err" &
race_b_pid=$!

race_a_status=0
race_b_status=0
wait "$race_a_pid" || race_a_status=$?
wait "$race_b_pid" || race_b_status=$?
if [[ "$race_a_status" -ne 0 || "$race_b_status" -ne 0 ]]; then
  echo "same-fingerprint concurrent calls did not both complete successfully" >&2
  cat "$ARTIFACT_DIR/race-a.err" "$ARTIFACT_DIR/race-b.err" >&2
  exit 1
fi
if [[ "$(tr -d '[:space:]' <"$ARTIFACT_DIR/race-a.out")" != "t" \
  || "$(tr -d '[:space:]' <"$ARTIFACT_DIR/race-b.out")" != "t" ]]; then
  echo "same-fingerprint concurrent calls did not both return true" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  expected_fingerprint text := encode(extensions.digest('shared-race@example.test','sha256'),'hex');
begin
  if (select count(*) from public.fan_connected_accounts
      where app_user_id in (
        '51000000-0000-4000-8000-000000000003'::uuid,
        '51000000-0000-4000-8000-000000000004'::uuid
      ) and provider='google' and status='connected') <> 2 then
    raise exception 'concurrent duplicate email blocked a canonical login projection';
  end if;
  if (select count(*) from public.fan_notification_channels
      where kind='email' and destination_fingerprint=expected_fingerprint) <> 1 then
    raise exception 'same-fingerprint race produced a non-canonical channel count';
  end if;
  if (select count(*) from public.fan_notification_channels channel
      join public.fan_notification_channel_private private on private.channel_id=channel.id
      where channel.kind='email'
        and channel.destination_fingerprint=expected_fingerprint
        and channel.app_user_id in (
          '51000000-0000-4000-8000-000000000003'::uuid,
          '51000000-0000-4000-8000-000000000004'::uuid
        )
        and private.destination='shared-race@example.test') <> 1 then
    raise exception 'same-fingerprint race did not preserve one normalized private destination';
  end if;
end $$;

select jsonb_build_object(
  'sequentialConnectedAccounts', 2,
  'sequentialChannels', 1,
  'concurrentConnectedAccounts', 2,
  'concurrentChannels', 1,
  'anonExecuteDenied', true,
  'authenticatedExecuteDenied', true,
  'status', 'PASS'
) as notification_email_conflict_result;

delete from public.fan_notification_channel_private private
using public.fan_notification_channels channel
where private.channel_id=channel.id
  and channel.app_user_id in (
    '51000000-0000-4000-8000-000000000001'::uuid,
    '51000000-0000-4000-8000-000000000002'::uuid,
    '51000000-0000-4000-8000-000000000003'::uuid,
    '51000000-0000-4000-8000-000000000004'::uuid
  );
delete from public.fan_notification_channels
where app_user_id in (
  '51000000-0000-4000-8000-000000000001'::uuid,
  '51000000-0000-4000-8000-000000000002'::uuid,
  '51000000-0000-4000-8000-000000000003'::uuid,
  '51000000-0000-4000-8000-000000000004'::uuid
);
delete from public.fan_connected_accounts
where app_user_id in (
  '51000000-0000-4000-8000-000000000001'::uuid,
  '51000000-0000-4000-8000-000000000002'::uuid,
  '51000000-0000-4000-8000-000000000003'::uuid,
  '51000000-0000-4000-8000-000000000004'::uuid
);
delete from public.app_users
where id in (
  '51000000-0000-4000-8000-000000000001'::uuid,
  '51000000-0000-4000-8000-000000000002'::uuid,
  '51000000-0000-4000-8000-000000000003'::uuid,
  '51000000-0000-4000-8000-000000000004'::uuid
);
SQL
