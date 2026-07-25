import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DATASET_KEY = "katseye-public-v1";
const KATSEYE_ID = "ca75e1e0-0000-4000-8000-000000000001";
const KATSEYE_QUIZ_ID = "ca75e1e0-0000-4000-8000-000000000002";
const KARA_ID = "4b415241-0000-4000-8000-000000000001";
const NUALEAF_ID = "4e55414c-4541-4600-8000-000000000001";
const MIGRATION_NAME = "20260726020000_katseye_public_dataset_v1.sql";
const EXPECTED_CONTENT_HASH =
  "4dc92a4fab61cc9f26bd6ae063b947f10884df8574b30e50f6ef6dc75ac92c44";
const MUTATION_CONFIRMATION = "I_UNDERSTAND_LOCAL_DATA_MUTATION";
const ARCHIVE_REASON =
  "KATSEYE public dataset v1 replaces KARA in public discovery";
const migrationPath = fileURLToPath(
  new URL(`../supabase/migrations/${MIGRATION_NAME}`, import.meta.url),
);
const supabaseConfigPath = fileURLToPath(
  new URL("../supabase/config.toml", import.meta.url),
);

const expectedIds = Object.freeze({
  notices: [
    "ca75e1e0-0000-4000-8000-000000002001",
    "ca75e1e0-0000-4000-8000-000000002002",
    "ca75e1e0-0000-4000-8000-000000002003",
  ],
  lives: [
    "ca75e1e0-0000-4000-8000-000000003001",
    "ca75e1e0-0000-4000-8000-000000003002",
    "ca75e1e0-0000-4000-8000-000000003003",
  ],
  benefits: [
    "ca75e1e0-0000-4000-8000-000000004001",
    "ca75e1e0-0000-4000-8000-000000004002",
    "ca75e1e0-0000-4000-8000-000000004003",
    "ca75e1e0-0000-4000-8000-000000004004",
  ],
});

function parseEnvOutput(output) {
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator);
        const raw = line.slice(separator + 1);
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [key, value];
      }),
  );
}

function localConnection() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: process.env.SUPABASE_URL.trim(),
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    };
  }

  let output;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(
      `KATSEYE_LOCAL_SUPABASE_UNAVAILABLE: start local Supabase or provide local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ${detail}`,
    );
  }
  const values = parseEnvOutput(output);
  const url = values.API_URL ?? values.SUPABASE_URL;
  const serviceRoleKey =
    values.SERVICE_ROLE_KEY ?? values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("KATSEYE_LOCAL_CREDENTIALS_MISSING");
  }
  return { url, serviceRoleKey };
}

function assertLocalUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(
      `KATSEYE_LOCAL_ONLY: refusing Supabase host ${url.hostname}`,
    );
  }
  return url;
}

function assertMutationOptIn() {
  if (process.env.BYUS_KATSEYE_ALLOW_LOCAL_MUTATION !== MUTATION_CONFIRMATION) {
    throw new Error(
      `KATSEYE_MUTATION_OPT_IN_REQUIRED: set BYUS_KATSEYE_ALLOW_LOCAL_MUTATION=${MUTATION_CONFIRMATION}`,
    );
  }
}

function createDatabase() {
  const connection = localConnection();
  const url = assertLocalUrl(connection.url);
  return {
    url,
    client: createClient(connection.url, connection.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

function migrationHash() {
  return createHash("sha256")
    .update(readFileSync(migrationPath))
    .digest("hex");
}

function assertDatasetContentHash() {
  const actual = migrationHash();
  if (actual !== EXPECTED_CONTENT_HASH) {
    throw new Error(
      `KATSEYE_DATASET_CONTENT_HASH_MISMATCH: expected ${EXPECTED_CONTENT_HASH}, received ${actual}`,
    );
  }
  return actual;
}

function must(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

async function maybeSingle(client, table, mutate, label) {
  return must(
    label,
    await mutate(client.from(table).select("*")).maybeSingle(),
  );
}

async function exactCount(client, table, mutate, label) {
  const result = await mutate(
    client.from(table).select("*", { count: "exact", head: true }),
  );
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.count ?? 0;
}

async function findCelebrity(client, slug) {
  return maybeSingle(
    client,
    "celebrities",
    (query) => query.eq("slug", slug),
    `${slug} celebrity lookup`,
  );
}

async function ownedCounts(client, celebrityId) {
  const liveRows = must(
    "owned LIVE id lookup",
    await client.from("live_events").select("id").eq("celebrity_id", celebrityId),
  );
  const benefitRows = must(
    "owned benefit id lookup",
    await client.from("benefits").select("id").eq("celebrity_id", celebrityId),
  );
  const liveIds = liveRows.map((row) => row.id);
  const benefitIds = benefitRows.map((row) => row.id);
  const entries = await Promise.all(
    [
      ["fanPassports", "fan_passports"],
      ["quizAttempts", "quiz_attempts"],
      ["quizPasses", "quiz_passes"],
      ["reservations", "live_reservations"],
      ["attendances", "live_attendances"],
      ["surveyResponses", "live_survey_responses"],
      ["activities", "fan_activities"],
      ["stamps", "stamps"],
      ["scoreLedger", "fan_score_ledger"],
      ["scoreAdjustments", "fan_score_adjustments"],
      ["benefitClaims", "benefit_claims"],
      ["benefitApplications", "benefit_applications"],
      ["levelEvents", "fan_level_events"],
      ["eligibilityChanges", "benefit_eligibility_changes"],
    ].map(async ([key, table]) => [
      key,
      await exactCount(
        client,
        table,
        (query) => query.eq("celebrity_id", celebrityId),
        `${table} count`,
      ),
    ]),
  );
  const notificationFilter = [
    `celebrity_id.eq.${celebrityId}`,
    ...liveIds.map((id) => `live_event_id.eq.${id}`),
    ...benefitIds.map((id) => `benefit_id.eq.${id}`),
  ].join(",");
  entries.push([
    "notifications",
    await exactCount(
      client,
      "fan_notifications",
      (query) => query.or(notificationFilter),
      "fan_notifications count",
    ),
  ]);
  return Object.fromEntries(entries);
}

async function preflightWith(client, url) {
  const [katseye, katseyeIdRow, kara, nualeaf, elina, changha] =
    await Promise.all([
      findCelebrity(client, "katseye"),
      maybeSingle(
        client,
        "celebrities",
        (query) => query.eq("id", KATSEYE_ID),
        "KATSEYE stable id lookup",
      ),
      findCelebrity(client, "kara"),
      maybeSingle(
        client,
        "brands",
        (query) => query.eq("slug", "nualeaf"),
        "NUALEAF lookup",
      ),
      findCelebrity(client, "elina"),
      findCelebrity(client, "changha"),
    ]);

  if (
    (katseye && katseye.id !== KATSEYE_ID) ||
    (katseyeIdRow && katseyeIdRow.slug !== "katseye")
  ) {
    throw new Error("KATSEYE_ID_OR_SLUG_COLLISION");
  }
  if (kara && kara.id !== KARA_ID) {
    throw new Error("KARA_STABLE_ID_MISMATCH");
  }
  if (nualeaf && nualeaf.id !== NUALEAF_ID) {
    throw new Error("NUALEAF_STABLE_ID_MISMATCH");
  }

  return {
    ok: true,
    command: "preflight",
    datasetKey: DATASET_KEY,
    migration: MIGRATION_NAME,
    contentHash: assertDatasetContentHash(),
    target: {
      origin: url.origin,
      host: url.hostname,
      localOnly: true,
    },
    katseye: katseye
      ? {
          id: katseye.id,
          status: katseye.status,
          archived: Boolean(katseye.archived_at),
          owned: await ownedCounts(client, KATSEYE_ID),
        }
      : null,
    kara: kara
      ? {
          id: kara.id,
          status: kara.status,
          archived: Boolean(kara.archived_at),
          owned: await ownedCounts(client, KARA_ID),
        }
      : null,
    nualeaf: nualeaf
      ? {
          id: nualeaf.id,
          status: nualeaf.status,
          archived: Boolean(nualeaf.archived_at),
        }
      : null,
    preservedCelebrities: {
      elina: elina
        ? { id: elina.id, status: elina.status, archived: Boolean(elina.archived_at) }
        : null,
      changha: changha
        ? {
            id: changha.id,
            status: changha.status,
            archived: Boolean(changha.archived_at),
          }
        : null,
    },
  };
}

async function verifyWith(client, url) {
  const katseye = await findCelebrity(client, "katseye");
  if (
    !katseye ||
    katseye.id !== KATSEYE_ID ||
    katseye.status !== "published" ||
    katseye.archived_at
  ) {
    throw new Error("KATSEYE_PUBLISHED_CELEBRITY_MISMATCH");
  }

  const quiz = await maybeSingle(
    client,
    "celebrity_quizzes",
    (query) => query.eq("id", KATSEYE_QUIZ_ID),
    "KATSEYE quiz lookup",
  );
  if (
    !quiz ||
    quiz.celebrity_id !== KATSEYE_ID ||
    quiz.status !== "published"
  ) {
    throw new Error("KATSEYE_PUBLISHED_QUIZ_MISMATCH");
  }

  const [
    localizationCount,
    socialCount,
    questionCount,
    optionCount,
    correctCount,
    noticeCount,
    noticeLocalizationCount,
    liveCount,
    liveLocalizationCount,
    benefitCount,
    benefitLocalizationCount,
    uniqueCodeCount,
  ] = await Promise.all([
    exactCount(
      client,
      "celebrity_localizations",
      (query) => query.eq("celebrity_id", KATSEYE_ID),
      "KATSEYE localization count",
    ),
    exactCount(
      client,
      "celebrity_social_links",
      (query) => query.eq("celebrity_id", KATSEYE_ID).eq("active", true),
      "KATSEYE social count",
    ),
    exactCount(
      client,
      "celebrity_quiz_questions",
      (query) => query.eq("quiz_id", KATSEYE_QUIZ_ID).eq("active", true),
      "KATSEYE question count",
    ),
    exactCount(
      client,
      "celebrity_quiz_options",
      (query) =>
        query.in(
          "question_id",
          Array.from(
            { length: 6 },
            (_, index) =>
              `ca75e1e0-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
          ),
        ),
      "KATSEYE option count",
    ),
    exactCount(
      client,
      "celebrity_quiz_options",
      (query) =>
        query
          .in(
            "question_id",
            Array.from(
              { length: 6 },
              (_, index) =>
                `ca75e1e0-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
            ),
          )
          .eq("active", true)
          .eq("is_correct", true),
      "KATSEYE correct option count",
    ),
    exactCount(
      client,
      "celebrity_notices",
      (query) =>
        query
          .in("id", expectedIds.notices)
          .eq("celebrity_id", KATSEYE_ID)
          .eq("publication_status", "published")
          .is("archived_at", null),
      "KATSEYE notice count",
    ),
    exactCount(
      client,
      "celebrity_notice_localizations",
      (query) => query.in("notice_id", expectedIds.notices),
      "KATSEYE notice localization count",
    ),
    exactCount(
      client,
      "live_events",
      (query) =>
        query
          .in("id", expectedIds.lives)
          .eq("celebrity_id", KATSEYE_ID)
          .eq("publication_status", "published")
          .is("archived_at", null),
      "KATSEYE LIVE count",
    ),
    exactCount(
      client,
      "live_event_localizations",
      (query) => query.in("live_event_id", expectedIds.lives),
      "KATSEYE LIVE localization count",
    ),
    exactCount(
      client,
      "benefits",
      (query) =>
        query
          .in("id", expectedIds.benefits)
          .eq("celebrity_id", KATSEYE_ID)
          .eq("publication_status", "published")
          .is("archived_at", null),
      "KATSEYE benefit count",
    ),
    exactCount(
      client,
      "benefit_localizations",
      (query) => query.in("benefit_id", expectedIds.benefits),
      "KATSEYE benefit localization count",
    ),
    exactCount(
      client,
      "benefit_unique_codes",
      (query) => query.eq("benefit_id", expectedIds.benefits[3]),
      "KATSEYE unique code inventory count",
    ),
  ]);

  const expectedCounts = {
    localizationCount: 2,
    socialCount: 3,
    questionCount: 6,
    optionCount: 24,
    correctCount: 6,
    noticeCount: 3,
    noticeLocalizationCount: 6,
    liveCount: 3,
    liveLocalizationCount: 6,
    benefitCount: 4,
    benefitLocalizationCount: 8,
    uniqueCodeCount: 12,
  };
  const actualCounts = {
    localizationCount,
    socialCount,
    questionCount,
    optionCount,
    correctCount,
    noticeCount,
    noticeLocalizationCount,
    liveCount,
    liveLocalizationCount,
    benefitCount,
    benefitLocalizationCount,
    uniqueCodeCount,
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (actualCounts[key] !== expected) {
      throw new Error(
        `KATSEYE_DATASET_COUNT_MISMATCH: ${key} expected ${expected}, received ${actualCounts[key]}`,
      );
    }
  }

  const lives = must(
    "KATSEYE LIVE status verification",
    await client
      .from("live_events")
      .select("id,content_status,starts_at,youtube_url")
      .in("id", expectedIds.lives),
  );
  const statusCounts = Object.groupBy(
    lives,
    (live) => live.content_status,
  );
  if (
    (statusCounts.scheduled?.length ?? 0) !== 2 ||
    (statusCounts.ended?.length ?? 0) !== 1
  ) {
    throw new Error("KATSEYE_LIVE_STATUS_MISMATCH");
  }
  if (lives.some((live) => !live.youtube_url.startsWith("https://www.youtube.com/"))) {
    throw new Error("KATSEYE_LIVE_LINK_MISMATCH");
  }

  const benefits = must(
    "KATSEYE benefit mode verification",
    await client
      .from("benefits")
      .select("id,delivery_type,allocation_mode")
      .in("id", expectedIds.benefits),
  );
  const deliveryModes = benefits.map((benefit) => benefit.delivery_type).sort();
  if (
    JSON.stringify(deliveryModes) !==
    JSON.stringify(["external_link", "shared_code", "text", "unique_code"])
  ) {
    throw new Error("KATSEYE_BENEFIT_DELIVERY_MODE_MISMATCH");
  }
  if (benefits.some((benefit) => benefit.allocation_mode !== "direct_claim")) {
    throw new Error("KATSEYE_BENEFIT_ALLOCATION_MODE_MISMATCH");
  }

  const storedIntegrity = must(
    "KATSEYE stored dataset integrity",
    await client.rpc("read_katseye_public_dataset_v1_integrity"),
  );
  if (
    !storedIntegrity?.expectedHash ||
    storedIntegrity.expectedHash !== storedIntegrity.actualHash
  ) {
    throw new Error(
      `KATSEYE_STORED_DATASET_DRIFT: ${JSON.stringify(storedIntegrity)}`,
    );
  }

  const personalRecords = await ownedCounts(client, KATSEYE_ID);

  return {
    ok: true,
    command: "verify",
    datasetKey: DATASET_KEY,
    migration: MIGRATION_NAME,
    contentHash: assertDatasetContentHash(),
    storedDatasetHash: storedIntegrity.actualHash,
    target: { origin: url.origin, host: url.hostname, localOnly: true },
    counts: {
      celebrity: 1,
      localizations: localizationCount,
      socials: socialCount,
      quizQuestions: questionCount,
      quizOptions: optionCount,
      notices: noticeCount,
      noticeLocalizations: noticeLocalizationCount,
      lives: liveCount,
      liveLocalizations: liveLocalizationCount,
      benefits: benefitCount,
      benefitLocalizations: benefitLocalizationCount,
      uniqueCodes: uniqueCodeCount,
    },
    personalRecords,
    personalDataPolicy:
      "reported-only; the dataset migration contains no personal record inserts",
  };
}

async function archiveKara(client) {
  const appUserId = process.env.BYUS_KATSEYE_ADMIN_APP_USER_ID?.trim();
  const allowlistId = process.env.BYUS_KATSEYE_ADMIN_ALLOWLIST_ID?.trim();
  if (!appUserId || !allowlistId) {
    throw new Error(
      "KATSEYE_ARCHIVE_ACTOR_REQUIRED: set BYUS_KATSEYE_ADMIN_APP_USER_ID and BYUS_KATSEYE_ADMIN_ALLOWLIST_ID",
    );
  }
  const correlationId = randomUUID();
  return must(
    "atomic KARA and NUALEAF public archive",
    await client.rpc("archive_kara_public_dataset_v1", {
      p_actor_app_user_id: appUserId,
      p_actor_admin_allowlist_id: allowlistId,
      p_correlation_id: correlationId,
      p_reason: ARCHIVE_REASON,
    }),
  );
}

function applyExactLocalMigration() {
  const config = readFileSync(supabaseConfigPath, "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*$/m)?.[1];
  if (!projectId) {
    throw new Error("KATSEYE_LOCAL_PROJECT_ID_MISSING");
  }
  const migrationSql = readFileSync(migrationPath, "utf8");
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "--interactive",
        `supabase_db_${projectId}`,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--set",
        "ON_ERROR_STOP=on",
        "--file",
        "-",
      ],
      {
        input: migrationSql,
        stdio: ["pipe", "inherit", "pipe"],
      },
    );
    execFileSync(
      "npx",
      [
        "supabase",
        "migration",
        "repair",
        "--local",
        "--status",
        "applied",
        MIGRATION_NAME.slice(0, 14),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: "inherit",
      },
    );
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`KATSEYE_EXACT_MIGRATION_FAILED: ${detail}`);
  }
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  if (!["preflight", "seed", "verify", "archive"].includes(command)) {
    throw new Error(
      "KATSEYE_COMMAND_INVALID: expected preflight, seed, verify, or archive",
    );
  }
  const { client, url } = createDatabase();

  if (command === "preflight") {
    return preflightWith(client, url);
  }
  if (command === "verify") {
    return verifyWith(client, url);
  }

  assertMutationOptIn();
  if (command === "seed") {
    const before = await preflightWith(client, url);
    if (!before.katseye) {
      applyExactLocalMigration();
    }
    return {
      ...(await verifyWith(client, url)),
      command: "seed",
      preflight: before,
    };
  }
  await verifyWith(client, url);
  return archiveKara(client);
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
