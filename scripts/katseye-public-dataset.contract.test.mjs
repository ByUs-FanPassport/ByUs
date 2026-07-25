import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260726020000_katseye_public_dataset_v1.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const tool = readFileSync(
  fileURLToPath(new URL("./katseye-public-dataset.mjs", import.meta.url)),
  "utf8",
);
const creditsPage = readFileSync(
  fileURLToPath(new URL("../apps/web/app/credits/page.tsx", import.meta.url)),
  "utf8",
);
const attributionModule = readFileSync(
  fileURLToPath(
    new URL("../apps/web/app/credits/katseye-attribution.ts", import.meta.url),
  ),
  "utf8",
);
const attributionPath = fileURLToPath(
  new URL(
    "../apps/web/public/images/celebrities/katseye/attribution.json",
    import.meta.url,
  ),
);
const attribution = JSON.parse(readFileSync(attributionPath, "utf8"));
const webPublicPath = fileURLToPath(
  new URL("../apps/web/public/", import.meta.url),
);

function webpDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    assert.equal(buffer.toString("hex", 23, 26), "9d012a");
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  throw new Error(`unsupported WebP chunk ${chunk}`);
}

test("KATSEYE v1 uses a new stable celebrity and complete public CMS rows", () => {
  assert.match(
    migration,
    /ca75e1e0-0000-4000-8000-000000000001[\s\S]*'katseye'/,
  );
  assert.match(migration, /exactly 6 quiz questions/);
  assert.match(migration, /exactly 3 published notices/);
  assert.match(migration, /exactly 3 published LIVE rows/);
  assert.match(migration, /exactly 4 published benefits/);
  assert.match(
    migration,
    /'text'[\s\S]*'external_link'[\s\S]*'shared_code'[\s\S]*'unique_code'/,
  );
  assert.equal(
    (migration.match(/insert into public\.celebrity_quiz_questions/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (migration.match(/insert into public\.celebrity_notices/g) ?? []).length,
    1,
  );
  assert.equal(
    (migration.match(/insert into public\.live_events/g) ?? []).length,
    1,
  );
  assert.equal(
    (migration.match(/insert into public\.benefits/g) ?? []).length,
    1,
  );
});

test("public dataset migration never seeds personal fan-owned tables", () => {
  for (const table of [
    "fan_passports",
    "quiz_attempts",
    "quiz_passes",
    "live_reservations",
    "live_attendances",
    "live_survey_responses",
    "fan_activities",
    "stamps",
    "fan_score_ledger",
    "fan_score_adjustments",
    "fan_notifications",
    "benefit_claims",
    "benefit_applications",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`insert into public\\.${table}`),
      `unexpected personal seed for ${table}`,
    );
  }
  assert.doesNotMatch(migration, /delete from public\./);
  assert.doesNotMatch(
    migration,
    /update public\.celebrities\s+set\s+slug\s*=\s*'kara'/,
  );
});

test("content wording is ByUs-authored and avoids official-affiliation claims", () => {
  assert.match(migration, /ByUs가 운영하는 팬 활동 공간/);
  assert.match(migration, /not official announcements or merchandise/);
  assert.doesNotMatch(migration, /OFFICIAL CELEBRITY|공식 셀럽|공식 공지/);
  assert.doesNotMatch(migration, /\bDEMO\b/);
});

test("tooling exposes four local-only commands with explicit mutation consent", () => {
  assert.match(
    tool,
    /\["preflight", "seed", "verify", "archive"\]\.includes\(command\)/,
  );
  assert.match(tool, /I_UNDERSTAND_LOCAL_DATA_MUTATION/);
  assert.match(tool, /KATSEYE_DATASET_CONTENT_HASH_MISMATCH/);
  const expectedContentHash = tool.match(
    /const EXPECTED_CONTENT_HASH =\s*"([0-9a-f]{64})"/,
  )?.[1];
  assert.equal(
    expectedContentHash,
    createHash("sha256").update(migration).digest("hex"),
  );
  assert.match(tool, /KATSEYE_STORED_DATASET_DRIFT/);
  assert.match(tool, /\["127\.0\.0\.1", "localhost", "::1"\]/);
  assert.match(tool, /"docker"[\s\S]*"psql"[\s\S]*"--file",[\s\S]*"-"/);
  assert.doesNotMatch(tool, /"migration",\s*"up"/);
  assert.doesNotMatch(tool, /--include-all/);
  assert.equal(
    (tool.match(/client\.rpc\("archive_kara_public_dataset_v1"/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(tool, /hard_delete_admin_content/);
});

test("KARA and NUALEAF archive is one child-first atomic PostgreSQL RPC", () => {
  assert.match(
    migration,
    /create function public\.archive_kara_public_dataset_v1\([\s\S]*language plpgsql[\s\S]*security definer/,
  );
  assert.match(
    migration,
    /admin_write_live_survey[\s\S]*set_admin_celebrity_notice_state[\s\S]*set_admin_benefit_state[\s\S]*quiz\.version\.retired_for_public_archive[\s\S]*archive_admin_content\([\s\S]*'live_event'[\s\S]*archive_admin_content\([\s\S]*'brand'[\s\S]*archive_admin_content\([\s\S]*'celebrity'/,
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_before := public\.katseye_owned_rows_snapshot/);
  assert.match(migration, /v_after := public\.katseye_owned_rows_snapshot/);
  assert.match(migration, /if v_after is distinct from v_before/);
  assert.match(migration, /raise exception 'KARA_OWNERSHIP_MUTATED'/);
  assert.match(migration, /NUALEAF has active LIVE dependencies/);
  assert.match(
    migration,
    /revoke all on function public\.archive_kara_public_dataset_v1[\s\S]*grant execute on function public\.archive_kara_public_dataset_v1[\s\S]*to service_role/,
  );
});

test("ownership snapshot covers direct and indirect fan history", () => {
  for (const table of [
    "quiz_attempts",
    "quiz_attempt_questions",
    "quiz_attempt_options",
    "quiz_attempt_answers",
    "quiz_passes",
    "fan_passports",
    "live_reservations",
    "live_attendances",
    "live_survey_responses",
    "live_survey_answers",
    "live_survey_idempotency",
    "fan_activities",
    "stamps",
    "fan_score_ledger",
    "fan_score_adjustments",
    "benefit_claims",
    "benefit_claim_audits",
    "benefit_applications",
    "benefit_claim_usage_events",
    "fan_level_events",
    "benefit_eligibility_changes",
    "fan_notifications",
    "notification_delivery_outbox",
  ]) {
    assert.match(
      migration,
      new RegExp(`from public\\.${table}\\b`),
      `missing preservation snapshot for ${table}`,
    );
  }
});

test("verify hashes a deterministic stored dataset snapshot", () => {
  assert.match(
    migration,
    /create function public\.read_katseye_public_dataset_v1_snapshot\(\)/,
  );
  assert.match(
    migration,
    /create table public\.public_dataset_integrity_manifests/,
  );
  assert.match(
    migration,
    /insert into public\.public_dataset_integrity_manifests[\s\S]*read_katseye_public_dataset_v1_snapshot\(\)::text/,
  );
  assert.match(tool, /read_katseye_public_dataset_v1_integrity/);
  assert.match(
    tool,
    /storedIntegrity\.expectedHash !== storedIntegrity\.actualHash/,
  );
});

test("credits render only from the validated attribution manifest", () => {
  assert.match(attributionModule, /attributionSchema\.parse\(rawAttribution\)/);
  assert.match(attributionModule, /Derivative paths must be unique/);
  assert.match(creditsPage, /katseyeAttribution\.sources\.map/);
  assert.doesNotMatch(creditsPage, /const sources =/);
  assert.doesNotMatch(creditsPage, /Warmtoned|David Lee/);
});

test("attribution records exact derivative hashes, dimensions, bytes, encoder, and crop", () => {
  const derivatives = attribution.sources.flatMap((source) =>
    source.derivatives.map((derivative) => ({ source, derivative })),
  );
  assert.equal(derivatives.length, 7);
  assert.equal(
    new Set(derivatives.map(({ derivative }) => derivative.path)).size,
    derivatives.length,
  );

  for (const { source, derivative } of derivatives) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.match(derivative.sha256, /^[0-9a-f]{64}$/);
    assert.ok(derivative.encoder.length > 0);
    assert.equal(derivative.crop.gravity, "center");
    assert.match(derivative.crop.aspectRatio, /^\d+:\d+$/);

    const path = `${webPublicPath}${derivative.path.slice(1)}`;
    const bytes = readFileSync(path);
    assert.equal(statSync(path).size, derivative.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      derivative.sha256,
    );
    assert.deepEqual(webpDimensions(bytes), {
      width: derivative.width,
      height: derivative.height,
    });
  }
});
