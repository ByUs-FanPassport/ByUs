import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// These fixtures are committed for cross-session visibility. Only the isolated
// clean-replay database is allowed; its owner tears the database down afterward.
assert.equal(process.env.PGDATABASE, 'byus_clean');
assert.ok(process.env.PGHOST?.startsWith('/'));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = (query) => execFileSync('psql', args, { input: query, encoding: 'utf8' }).trim();
assert.equal(sql('select current_database()'), 'byus_clean');
const source = readFileSync(new URL('../supabase/tests/telegram_certification_reviews.sql', import.meta.url), 'utf8');
const helperStart = source.indexOf('create function pg_temp.create_telegram_certification_fixture');
const helperEnd = source.indexOf('end $$;', helperStart) + 'end $$;'.length;
assert.ok(helperStart > 0 && helperEnd > helperStart);
const ids = JSON.parse(sql(`${source.slice(0, helperEnd)}
select jsonb_build_array(
 pg_temp.create_telegram_certification_fixture('telegram-race-one','a9400000-0000-4000-8000-000000000081',2::smallint,1::bigint),
 pg_temp.create_telegram_certification_fixture('telegram-race-two','a9400000-0000-4000-8000-000000000082',2::smallint,1::bigint));
commit;`));
const chat = '-1001234567890';
function concurrent(query) {
  return new Promise((resolve) => {
    const child = spawn('psql', args);
    let out = '', error = '';
    child.stdout.on('data', (value) => { out += value; });
    child.stderr.on('data', (value) => { error += value; });
    child.on('close', (code) => resolve({ code, out: out.trim(), error }));
    child.stdin.end(`set statement_timeout='10s'; ${query}`);
  });
}
const claimQuery = `select public.claim_telegram_certification_delivery('${chat}')`;
const claims = await Promise.all([concurrent(claimQuery), concurrent(claimQuery)]);
assert.ok(claims.every((result) => result.code === 0));
assert.equal(claims.filter((result) => result.out).length, 1, 'one concurrent claim wins');
const first = JSON.parse(claims.find((result) => result.out).out);
assert.ok(ids.includes(first.submission_id));
function sent(claim, messageId) {
  const upload = claim.uploads[0];
  sql(`select public.record_telegram_certification_delivery('${claim.delivery_id}','${chat}','${claim.lease_token}','sending','${upload.upload_id}',1);
    select public.record_telegram_certification_delivery('${claim.delivery_id}','${chat}','${claim.lease_token}','sent','${upload.upload_id}',1,${messageId});`);
}
function approve(claim, messageId, actor) {
  return `select public.approve_telegram_certification('${chat}','${claim.callback_token}',${messageId},${actor},'Race reviewer','race_reviewer')`;
}
function exactRewards(submissionId) {
  const counts = JSON.parse(sql(`select jsonb_build_object(
    'approved',(select count(*) from public.certification_submissions where id='${submissionId}' and status='approved' and review_revision=2),
    'score',(select count(*) from public.fan_score_ledger where manual_submission_id='${submissionId}' and points=2),
    'ticket',(select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id='${submissionId}' and amount=1),
    'audit',(select count(*) from public.audit_logs where entity_id='${submissionId}' and action='certification.submission.approved'))`));
  assert.deepEqual(counts, { approved: 1, score: 1, ticket: 1, audit: 1 });
}
sent(first, 9081);
const clicks = await Promise.all([concurrent(approve(first, 9081, 7081)), concurrent(approve(first, 9081, 7082))]);
assert.ok(clicks.every((result) => result.code === 0));
assert.deepEqual(clicks.map((result) => JSON.parse(result.out).outcome).sort(), ['already_processed', 'approved']);
exactRewards(first.submission_id);
sql("update public.telegram_certification_review_settings set next_send_at='-infinity'");
const second = JSON.parse(sql(claimQuery));
assert.notEqual(second.submission_id, first.submission_id);
sent(second, 9082);
const web = `select public.review_admin_certification_submission(
  'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',
  extensions.gen_random_uuid(),'${second.submission_id}',extensions.gen_random_uuid(),1,'approve',null)`;
const [webResult, telegramResult] = await Promise.all([concurrent(web), concurrent(approve(second, 9082, 7083))]);
assert.equal(telegramResult.code, 0);
assert.ok(['approved', 'already_processed'].includes(JSON.parse(telegramResult.out).outcome));
if (webResult.code !== 0) assert.match(webResult.error, /CERTIFICATION_STALE_REVISION/);
exactRewards(second.submission_id);
console.log('PASS certification concurrent claims, duplicate Telegram clicks, web/Telegram approval and exactly-once rewards');
