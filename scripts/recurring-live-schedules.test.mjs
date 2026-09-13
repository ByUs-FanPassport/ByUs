import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRecurringInput, validateRecurringRule, sqlLiteral } from "./lib/recurring-live-input.mjs";
import { parseArguments, runCommand } from "./recurring-live-schedules.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const rule = { timeZone: "Asia/Seoul", effectiveFrom: "2026-09-13", effectiveUntil: null, provider: "tiktok", channelUrl: "https://www.tiktok.com/@ifewknow/live", slots: [{ id, isoWeekday: 1, localStartTime: "07:00", end: null }] };
const input = { version: 1, runId: id, rosterObservedAt: "2026-09-13T12:00:00Z", creators: [{ celebrityId: id, result: "regular", verification: "verified", observations: [{ sourceUrl: "https://www.tiktok.com/@ifewknow", sourceAccount: null, sourcePublishedAt: null, observedAt: "2026-09-13T12:00:00Z", originalText: "Mon-Fri 7am KST", evidencePath: null, contentHash: "a".repeat(64) }], seriesKey: "weekday-morning", proposedRule: rule, expectedCurrentRevisionId: null }] };
test("unknown end and stable slot survive validation; unsafe and ambiguous inputs fail", () => {
  assert.equal(validateRecurringInput(input), input);
  for (const patch of [{ effectiveFrom: "2026-02-30" }, { timeZone: "Invalid/Zone" }, { channelUrl: "https://tiktok.com.evil.test/@creator" }, { slots: [rule.slots[0], rule.slots[0]] }, { mystery: true }]) assert.throws(() => validateRecurringRule({ ...rule, ...patch }));
  assert.throws(() => validateRecurringInput({ ...input, creators: [{ ...input.creators[0], verification: "not_found" }] }));
  assert.throws(() => validateRecurringInput({ ...input, creators: [input.creators[0], input.creators[0]] }));
});
test("commands require explicit write mode and preserve SQL literal boundaries", () => {
  assert.throws(() => parseArguments(["import", "--input", "x"]));
  assert.throws(() => parseArguments(["import", "--apply", "--dry-run"]));
  assert.throws(() => parseArguments(["verify", "--apply"]));
  assert.throws(() => parseArguments(["roster", "--output", "a", "--output", "b"]));
  assert.equal(sqlLiteral("x');select pg_sleep(5);--"), "'x'');select pg_sleep(5);--'");
});
test("dry run only reads roster and catches newly published creators", async () => {
  const temp = await mkdtemp(join(tmpdir(), "recurring-test-"));
  try {
    const file = join(temp, "input.json"); await writeFile(file, JSON.stringify(input));
    const calls=[];
    const result=await runCommand("import", { input:file,"dry-run":true }, async sql=>{calls.push(sql);return {celebrities:[{id}]};});
    assert.equal(result.dryRun,true); assert.equal(result.proposedRuleCount,1); assert.equal(calls.length,1); assert.match(calls[0],/get_recurring_live_roster/);
    await assert.rejects(()=>runCommand("import",{input:file,"dry-run":true},async()=>({celebrities:[{id},{id:"22222222-2222-4222-8222-222222222222"}]})),/Roster changed/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
test("replenish dry-run never mutates, apply maintains chosen idempotent run ID", async()=>{
  const calls=[]; const q=async sql=>{calls.push(sql);return {status:"completed"};};
  await runCommand("replenish",{"dry-run":true,days:"49"},q);
  assert.equal(calls.length,1);assert.match(calls[0],/verify_recurring_live_coverage/);
  await runCommand("replenish",{apply:true,days:"49","run-id":id,now:"2026-09-13T00:00:00Z"},q);
  assert.match(calls[1],/replenish_recurring_live_events/);assert.match(calls[1],new RegExp(id));
});
