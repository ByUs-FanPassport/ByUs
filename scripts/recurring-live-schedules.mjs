#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { validateRecurringInput, sqlLiteral } from "./lib/recurring-live-input.mjs";
const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseArguments(args) {
  const [command, ...rest] = args;
  if (!["roster", "import", "bootstrap", "replenish", "verify"].includes(command)) throw new Error("Use roster, import, bootstrap, replenish, or verify");
  const options = {};
  const known = new Set(["linked-workdir", "output", "input", "apply", "dry-run", "run-id", "expected-input-hash", "admin-user-id", "admin-allowlist-id", "days", "required-days", "now"]);
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "");
    if (!rest[i].startsWith("--") || !known.has(key) || key in options) throw new Error("Invalid or duplicate command option");
    if (["apply", "dry-run"].includes(key)) options[key] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error(`Missing ${key}`); options[key] = rest[++i]; }
  }
  if (["import", "bootstrap", "replenish"].includes(command) && Boolean(options.apply) === Boolean(options["dry-run"])) throw new Error("Choose exactly one of --dry-run or --apply");
  if (["roster", "verify"].includes(command) && (options.apply || options["dry-run"])) throw new Error("This command is read-only");
  return { command, options };
}
export async function queryLinked(sql, workdir) {
  if (!workdir) throw new Error("Set --linked-workdir to the existing linked ByUs checkout");
  const project = (await readFile(join(workdir, "supabase/.temp/project-ref"), "utf8")).trim();
  if (project !== "gmrykvmtmuaeswpajteq") throw new Error("Refusing an unexpected linked Supabase project");
  const temp = await mkdtemp(join(tmpdir(), "byus-recurring-"));
  try {
    const file = join(temp, "query.sql");
    await writeFile(file, `begin;\nset local lock_timeout='5s';\nset local statement_timeout='90s';\nset local role service_role;\n${sql}\ncommit;\n`, { mode: 0o600 });
    const { stdout } = await execute("supabase", ["db", "query", "--linked", "--workdir", workdir, "--output", "json", "--file", file], { maxBuffer: 8 * 1024 * 1024 });
    const envelope = JSON.parse(stdout);
    const rows = Array.isArray(envelope) ? envelope : envelope.rows;
    if (!Array.isArray(rows) || rows.length !== 1 || !("result" in rows[0])) throw new Error("Unexpected database response");
    return rows[0].result;
  } catch (error) {
    // SDK/CLI exceptions can include credentials and raw SQL; keep them out of output.
    if (error instanceof Error && error.message === "Unexpected database response") throw error;
    const marker = typeof error?.stderr === "string" ? error.stderr.match(/\bRECURRING_LIVE_[A-Z_]+\b/)?.[0] : null;
    throw new Error(marker ?? "Recurring database operation failed; check the linked project and reviewed input");
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export async function runCommand(command, options, query) {
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(now)) throw new Error("Invalid --now instant");
  const q = async (name, argumentsSql = "") => query(`select public.${name}(${argumentsSql}) as result;`);
  if (command === "roster") return q("get_recurring_live_roster");
  if (command === "verify") {
    const days = Number(options["required-days"] ?? 42);
    if (!Number.isInteger(days) || days < 1 || days > 49) throw new Error("Invalid required days");
    return q("verify_recurring_live_coverage", `${sqlLiteral(now)}::timestamptz,${days}`);
  }
  if (command === "import") {
    if (!options.input) throw new Error("--input is required");
    const raw = await readFile(options.input, "utf8");
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Input exceeds 4 MiB");
    const input = validateRecurringInput(JSON.parse(raw));
    const roster = await q("get_recurring_live_roster");
    const liveIds = new Set(roster.celebrities.map(creator => creator.id));
    const suppliedIds = new Set(input.creators.map(creator => creator.celebrityId));
    if ([...liveIds].some(id => !suppliedIds.has(id)) || [...suppliedIds].some(id => !liveIds.has(id))) throw new Error("Roster changed or input omits a published creator; refresh research input");
    if (options["dry-run"]) return { dryRun: true, runId: input.runId, creatorCount: input.creators.length, proposedRuleCount: input.creators.filter(c => c.proposedRule).length, observationCount: input.creators.reduce((n,c) => n+c.observations.length,0), scope: "Input and current roster validated. No rules approved and no events generated." };
    return q("import_recurring_live_observations", `${sqlLiteral(input.runId)}::uuid,${sqlLiteral(`recurring:v1:${input.runId}`)},${sqlLiteral(JSON.stringify(input))}::jsonb`);
  }
  if (command === "bootstrap") {
    const user = options["admin-user-id"] ?? process.env.BYUS_RECURRING_ADMIN_USER_ID;
    const allowlist = options["admin-allowlist-id"] ?? process.env.BYUS_RECURRING_ADMIN_ALLOWLIST_ID;
    if (!uuid.test(user ?? "") || !uuid.test(allowlist ?? "") || !uuid.test(options["run-id"] ?? "")) throw new Error("Bootstrap requires the authorized administrator IDs and --run-id");
    if (!/^[a-f0-9]{64}$/.test(options["expected-input-hash"] ?? "")) throw new Error("Bootstrap requires the reviewed import inputHash");
    const current = await q("get_admin_recurring_live_schedules", `${sqlLiteral(user)}::uuid,${sqlLiteral(allowlist)}::uuid`);
    const revisions = current.reviews.filter(review => review.reason === "initial" && (review.runId === options["run-id"] || review.reviewPayload?.runId === options["run-id"]));
    if (options["dry-run"]) return { dryRun: true, runId: options["run-id"], expectedInputHash: options["expected-input-hash"], proposedRuleRevisionIds: revisions.map(r=>r.id), reviews: revisions };
    return q("approve_initial_recurring_live_rules", `${sqlLiteral(user)}::uuid,${sqlLiteral(allowlist)}::uuid,${sqlLiteral(options["run-id"])}::uuid,${sqlLiteral(options["expected-input-hash"])},array[${revisions.map(r=>`${sqlLiteral(r.id)}::uuid`).join(",")}]::uuid[],${sqlLiteral(randomUUID())}::uuid`);
  }
  const days = Number(options.days ?? 49);
  if (!Number.isInteger(days) || days < 1 || days > 49) throw new Error("Generation horizon must be 1–49 days");
  if (options["dry-run"]) return { dryRun: true, requestedDays: days, coverage: await q("verify_recurring_live_coverage", `${sqlLiteral(now)}::timestamptz,42`), scope: "Read-only current coverage. Creation counts are determined transactionally on apply." };
  const runId = options["run-id"] ?? randomUUID();
  if (!uuid.test(runId)) throw new Error("Invalid run ID");
  return q("replenish_recurring_live_events", `${sqlLiteral(runId)}::uuid,${days},${sqlLiteral(now)}::timestamptz`);
}
async function main() {
  try {
    const { command, options } = parseArguments(process.argv.slice(2));
    const result = await runCommand(command, options, sql => queryLinked(sql, options["linked-workdir"] ?? process.env.BYUS_SUPABASE_WORKDIR));
    const output = JSON.stringify(result, null, 2) + "\n";
    if (options.output) { const file = resolve(options.output); await mkdir(dirname(file), { recursive: true }); await writeFile(file, output, { mode: 0o600 }); }
    process.stdout.write(output);
    if (!result.dryRun && (result.needsReview === true || result.needsReviewCount > 0 || result.status === "needs_review" || result.status === "incomplete")) process.exitCode = 3;
  } catch (error) { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : "Recurring operation failed" }) + "\n"); process.exitCode = 2; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
