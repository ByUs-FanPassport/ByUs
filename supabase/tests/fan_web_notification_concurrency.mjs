// Run only against a disposable latest-chain database; commits synthetic fixtures.
// FAN_WEB_DISPOSABLE_DB_URL=... node supabase/tests/fan_web_notification_concurrency.mjs
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const database = process.env.FAN_WEB_DISPOSABLE_DB_URL;
if (!database) throw new Error("FAN_WEB_DISPOSABLE_DB_URL must name the disposable test database");
const parsed = new URL(database);
const socket = parsed.searchParams.get("host") || process.env.PGHOST || parsed.hostname;
const port = parsed.searchParams.get("port") || parsed.port || process.env.PGPORT;
if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || decodeURIComponent(parsed.pathname) !== "/byus_clean"
  || !socket.startsWith("/") || !/(?:^|\/)byus-clean-db\.[^/]+\/socket\/?$/.test(socket)
  || !port || !/^\d{2,5}$/.test(port) || Number(port) > 65535
  || [...parsed.searchParams.keys()].some(key => !["host", "port"].includes(key) || parsed.searchParams.getAll(key).length !== 1)
  || process.env.PGHOSTADDR || process.env.PGSERVICE) {
  throw new Error("Race harness requires byus_clean on a private byus-clean-db.*/socket with an explicit local port");
}
const psql = process.env.PSQL_BIN || "psql";
const args = [database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
function sql(source) {
  try { return execFileSync(psql, args, { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch (error) { throw new Error(`Disposable database assertion query failed: ${String(error.stderr || "psql exited without stderr").trim().slice(0,1500)}`); }
}
const a = randomUUID(), b = randomUUID(), targetA = randomUUID(), targetB = randomUUID();
sql(`insert into public.app_users(id,privy_user_id,verified_email) values
 ('${a}','did:privy:race-${a}','${a}@example.test'),('${b}','did:privy:race-${b}','${b}@example.test');`);
function locked(owner) {
  const child = spawn(psql, args, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "";
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`race session failed (${code}): ${error.slice(0,500)}`)));
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("lock barrier timed out")); }, 10_000);
    child.stdout.on("data", bytes => { output += bytes; if (output.includes("FAN_WEB_LOCKED")) { clearTimeout(timer); resolve(); } });
    child.stderr.on("data", bytes => { error += bytes; });
    child.on("error", reject);
  });
  child.stdin.write(`begin; set local statement_timeout='6s'; set local idle_in_transaction_session_timeout='12s'; select public.fan_web_lock_active_user('${owner}');\n\\echo FAN_WEB_LOCKED\n`);
  return { ready, done, child };
}
const left = locked(a), right = locked(b);
await Promise.all([left.ready, right.ready]);
// Each session holds its actor lock while producing an event for the other owner.
// A synchronous recipient lock would deadlock here; durable intents must not.
left.child.stdin.end(`select public.fan_web_emit_notification('${b}','content_reply','fan_post_comment','${targetB}',1,now()); commit;`);
right.child.stdin.end(`select public.fan_web_emit_notification('${a}','content_reply','fan_post_comment','${targetA}',1,now()); commit;`);
await Promise.all([left.done, right.done]);
assert.equal(sql(`select count(*) from public.fan_web_notification_intents where recipient_app_user_id in('${a}','${b}');`), "2");
assert.equal(sql(`select public.fan_web_drain_notification_intents('${a}')+public.fan_web_drain_notification_intents('${b}');`), "2");
assert.equal(sql(`select public.fan_web_drain_notification_intents('${a}')+public.fan_web_drain_notification_intents('${b}');`), "0");
assert.equal(sql(`select count(*) from public.fan_notifications where app_user_id in('${a}','${b}') and web_only;`), "2");
// A held recipient lock delays materialization, never drops the committed intent.
const held = locked(a); await held.ready;
sql(`select public.fan_web_emit_notification('${a}','content_reply','fan_post_comment','${randomUUID()}',1,now());`);
assert.equal(sql(`select count(*) from public.fan_web_notification_intents where recipient_app_user_id='${a}';`), "1");
held.child.stdin.end("commit;"); await held.done;
assert.equal(sql(`select public.fan_web_drain_notification_intents('${a}');`), "1");
console.log("PASS: reciprocal actor locks do not deadlock; committed intents survive held recipient locks and drain exactly once");

// An already authorized owner write commits before deletion obtains the common
// lock. A write started after disablement is rejected; private upload cleanup is
// still pending until the registered in-flight upload settles.
const writing = locked(a); await writing.ready;
writing.child.stdin.write(`insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values('${a}','Race profile','race profile');
select public.fan_web_begin_private_upload('${a}','fan-avatars','${a}/race.webp');\n`);
const deleting = spawn(psql, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: `fan-deletion-race-${a}` } });
const deleted = new Promise((resolve, reject) => { deleting.on("error", reject); deleting.on("exit", code => code === 0 ? resolve() : reject(new Error("Deletion race failed"))); });
deleting.stdin.end(`select public.begin_owned_account_deletion('did:privy:race-${a}');`);
let waiting = false;
for (let tries = 0; tries < 60; tries++) {
  if (sql(`select count(*) from pg_stat_activity where application_name='fan-deletion-race-${a}' and wait_event='advisory';`) === "1") { waiting = true; break; }
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert(waiting, "deletion must wait for the in-flight owner write");
writing.child.stdin.end("commit;"); await writing.done; await deleted;
assert.equal(sql(`select status from public.app_users where id='${a}';`), "disabled");
assert.throws(() => sql(`select public.fan_web_patch_notification_preferences('${a}','{"reply_notifications":true}');`));
assert.throws(() => sql(`select * from public.sync_privy_identity('did:privy:race-${a}','${a}@example.test',91342,'0x${"a".repeat(40)}');`));
// Two workers cannot acquire the same live cleanup lease.
function claim() {
  const child = spawn(psql, args, { stdio: ["pipe", "pipe", "pipe"] }); let value = "";
  child.stdout.on("data", bytes => { value += bytes; });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve(value.trim()) : reject(new Error("Cleanup lease race failed"))); });
  child.stdin.end(`select public.claim_account_deletion('${a}');`); return done;
}
const claims = (await Promise.all([claim(), claim()])).filter(Boolean).map(value => JSON.parse(value));
assert.equal(claims.length, 1, "only one cleanup worker may own the lease");
assert.equal(sql(`select count(*) from public.user_profiles where app_user_id='${a}';`), "0");
assert.equal(sql(`select public.account_deletion_storage_ready('${a}','${claims[0].leaseToken}');`), "f");
console.log("PASS: owner write/delete serialization, disabled write+sync rejection, exclusive cleanup lease and in-flight upload gate");

// Real reciprocal share visits take both participant locks in UUID order. Hold
// the lower UUID externally so both sessions meet at the same deterministic gate.
const shareOwners = [randomUUID(), randomUUID()].sort();
const artist = randomUUID(), quiz = randomUUID(), slug = `share-race-${artist}`;
sql(`begin; insert into public.app_users(id,privy_user_id,verified_email) values
 ('${shareOwners[0]}','did:privy:share-${shareOwners[0]}','${shareOwners[0]}@example.test'),
 ('${shareOwners[1]}','did:privy:share-${shareOwners[1]}','${shareOwners[1]}@example.test');
 insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
 values('${artist}','${slug}','published','/test.webp',now(),'{creator}','creator');
 insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
 ('${artist}','ko','공유 검증','소개','사진'),('${artist}','en','Share QA','Summary','Photo');
 insert into public.celebrity_quizzes(id,celebrity_id,version,status) values('${quiz}','${artist}',1,'draft'); commit;`);
const tokens = [];
for (const owner of shareOwners) {
  const attempt = randomUUID(), pass = randomUUID(), passport = randomUUID(), job = randomUUID();
  const wallet = `0x${owner.replaceAll("-", "")}00000000`;
  sql(`begin; insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values('${owner}',91342,'${wallet}','privy','embedded');
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values('${attempt}','${owner}','${artist}','${quiz}',1,'${attempt}','passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values('${pass}','${owner}','${artist}','${attempt}');
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values('${job}','passport','${passport}','byus:passport:v1:${owner}:${slug}',1,jsonb_build_object('recipient','${wallet}','celebritySlug','${slug}','passportId','0x${passport.replaceAll("-", "").repeat(2)}'));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id) values('${passport}','${owner}','${artist}','${pass}','${job}'); commit;`);
  tokens.push(sql(`select public.create_community_stamp_share_link('${owner}','${slug}')->>'token';`));
}
const gate = locked(shareOwners[0]); await gate.ready;
const visits = shareOwners.map((owner, index) => {
  const child = spawn(psql, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: `fan-share-race-${artist}-${index}` } });
  let error = "";
  child.stderr.on("data", bytes => { error = (error + bytes).slice(0,1500); });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Reciprocal share visit failed (${code}): ${error}`))); });
  child.stdin.end(`set statement_timeout='8s'; select public.visit_community_stamp_share_link('${owner}','${tokens[1-index]}');`);
  return done;
});
let bothWaiting = false;
for (let tries = 0; tries < 60; tries++) {
  if (sql(`select count(*) from pg_stat_activity where application_name like 'fan-share-race-${artist}-%' and wait_event='advisory';`) === "2") { bothWaiting = true; break; }
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert(bothWaiting, "both reciprocal visits must reach the lock barrier");
gate.child.stdin.end("commit;"); await gate.done; await Promise.all(visits);
assert.equal(sql(`select count(*) from public.community_stamp_share_visits v join public.community_stamp_share_links l on l.id=v.share_link_id where l.celebrity_id='${artist}';`), "2");
assert.equal(sql(`select count(*) from public.community_stamps where celebrity_id='${artist}' and kind='share';`), "2");
console.log("PASS: reciprocal share visits serialize without deadlock and preserve one reward per sender");
