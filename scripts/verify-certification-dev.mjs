import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const databaseUrl = process.env.BYUS_DEV_DATABASE_URL;
if (!databaseUrl) throw new Error('BYUS_DEV_DATABASE_URL is required');
const DEV_PROJECT_REF = 'xcppyedwusirqnfpbtit';
const PRODUCTION_PROJECT_REF = 'gmrykvmtmuaeswpajteq';
let connection;
try { connection = new URL(databaseUrl); } catch { throw new Error('BYUS_DEV_DATABASE_URL must be a PostgreSQL URL for the approved Dev project'); }
if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('BYUS_DEV_DATABASE_URL must use the PostgreSQL protocol');
const connectionIdentity = `${connection.hostname}:${decodeURIComponent(connection.username)}`;
if (connectionIdentity.includes(PRODUCTION_PROJECT_REF)) throw new Error('Production Supabase is forbidden for certification verification');
if (!connectionIdentity.includes(DEV_PROJECT_REF)) throw new Error(`Only approved Dev Supabase ${DEV_PROJECT_REF} is allowed`);
const databaseName = decodeURIComponent(connection.pathname.replace(/^\//, ''));
const databaseUser = decodeURIComponent(connection.username);
const databasePassword = decodeURIComponent(connection.password);
if (!connection.hostname || !databaseName || !databaseUser || !databasePassword) throw new Error('Dev PostgreSQL URL must include host, database, user, and password');

const psql = process.env.PSQL_BIN ?? '/opt/homebrew/bin/psql';
const args = ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
const env = {
  ...process.env,
  PGHOST: connection.hostname,
  PGPORT: connection.port || '5432',
  PGDATABASE: databaseName,
  PGUSER: databaseUser,
  PGPASSWORD: databasePassword,
  PGSSLMODE: 'require',
  PGCONNECT_TIMEOUT: '10',
};

function safeError(value) {
  return String(value).replaceAll(databaseUrl, '[database URL redacted]').trim();
}

function run(sql) {
  const result = spawnSync(psql, args, { input: sql, encoding: 'utf8', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(safeError(result.stderr));
  return result.stdout.trim();
}

function runSession(sql) {
  const child = spawn(psql, args, { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(sql);
  return new Promise((resolve) => child.on('close', (code) => resolve({
    code,
    stdout: stdout.trim(),
    stderr: safeError(stderr),
  })));
}

const id = () => randomUUID();
const runKey = randomUUID().replaceAll('-', '').slice(0, 16);
const owner = id();
const admin = id();
const allowlist = id();
const celebrity = id();
const approveApproveMission = id();
const approveRejectMission = id();
const approveApproveReward = id();
const approveRejectReward = id();
const approveApproveSubmission = id();
const approveRejectSubmission = id();
const ids = {
  approveApprove: { correlationA: id(), correlationB: id(), operationA: id(), operationB: id() },
  approveReject: { correlationA: id(), correlationB: id(), operationA: id(), operationB: id() },
};

const review = (submission, correlation, operation, decision) => `
select public.review_admin_certification_submission(
  '${admin}','${allowlist}','${correlation}','${submission}','${operation}',1,
  '${decision}',${decision === 'reject' ? "'concurrent rejection reason'" : 'null'}
);`;

const setup = `
begin;
insert into public.app_users(id,privy_user_id,verified_email,status) values
('${owner}','did:privy:cert-concurrency-owner-${runKey}','cert-concurrency-owner-${runKey}@byus.test','active'),
('${admin}','did:privy:cert-concurrency-admin-${runKey}','cert-concurrency-admin-${runKey}@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
('${allowlist}','cert-concurrency-admin-${runKey}@byus.test','admin',true);
insert into public.celebrities(id,slug,status,image_url,published_at,roles) values
('${celebrity}','cert-concurrency-${runKey}','draft','/cert-concurrency.webp',null,'{artist}');
insert into public.certification_missions(
  id,celebrity_id,immutable_key,status,category,title_ko,title_en,description_ko,
  description_en,instructions_ko,instructions_en,opens_at,closes_at,activated_at
) values
('${approveApproveMission}','${celebrity}','cert-concurrency-aa-${runKey}','active','기타','동시 승인','Concurrent approve','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',now()),
('${approveRejectMission}','${celebrity}','cert-concurrency-ar-${runKey}','active','기타','승인 반려','Approve reject','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',now());
commit;
`;

const rewardAndSubmissionSetup = `
begin;
insert into public.certification_reward_revisions(
  id,mission_id,revision,policy_version,score_points,ticket_amount,
  actor_app_user_id,actor_admin_allowlist_id,correlation_id
) values
('${approveApproveReward}','${approveApproveMission}',1,(select policy_version from public.reward_policy_activation where singleton),2,1,'${admin}','${allowlist}','${id()}'),
('${approveRejectReward}','${approveRejectMission}',1,(select policy_version from public.reward_policy_activation where singleton),2,1,'${admin}','${allowlist}','${id()}');
insert into public.certification_submissions(
  id,app_user_id,celebrity_id,mission_id,mission_revision,reward_revision_id,
  reward_revision,reward_policy_version,reward_score_points,reward_ticket_amount,
  attempt_number,idempotency_key,request_hash
) values
('${approveApproveSubmission}','${owner}','${celebrity}','${approveApproveMission}',1,'${approveApproveReward}',1,(select policy_version from public.reward_policy_activation where singleton),2,1,1,'${id()}',repeat('a',64)),
('${approveRejectSubmission}','${owner}','${celebrity}','${approveRejectMission}',1,'${approveRejectReward}',1,(select policy_version from public.reward_policy_activation where singleton),2,1,1,'${id()}',repeat('b',64));
commit;`;

const cleanup = `
begin;
set local session_replication_role=replica;
delete from public.certification_review_operations where submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}');
delete from public.fan_score_ledger where manual_submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}');
delete from public.fan_ticket_ledger where source_type='manual_certification' and source_id in ('${approveApproveSubmission}','${approveRejectSubmission}');
delete from public.certification_uploads where mission_id in ('${approveApproveMission}','${approveRejectMission}') or consumed_submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}');
delete from public.certification_submissions where id in ('${approveApproveSubmission}','${approveRejectSubmission}') or mission_id in ('${approveApproveMission}','${approveRejectMission}');
delete from public.certification_reward_revisions where id in ('${approveApproveReward}','${approveRejectReward}') or mission_id in ('${approveApproveMission}','${approveRejectMission}');
delete from public.certification_missions where id in ('${approveApproveMission}','${approveRejectMission}');
do $$
declare target record;
begin
  for target in
    select c.table_schema,c.table_name,c.column_name
    from information_schema.columns c
    join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and t.table_type='BASE TABLE'
      and c.column_name in ('app_user_id','actor_app_user_id','owner_app_user_id','celebrity_id')
  loop
    if target.column_name in ('app_user_id','actor_app_user_id','owner_app_user_id') then
      execute format('delete from %I.%I where %I = any($1)',target.table_schema,target.table_name,target.column_name)
      using array['${owner}'::uuid,'${admin}'::uuid];
    else
      execute format('delete from %I.%I where %I=$1',target.table_schema,target.table_name,target.column_name)
      using '${celebrity}'::uuid;
    end if;
  end loop;
  delete from public.admin_allowlist where id='${allowlist}';
  delete from public.app_users where id in ('${owner}','${admin}');
  delete from public.celebrities where id='${celebrity}';
end $$;
commit;`;

const verifyCleanup = `
with fixture_residue as (
  select (select count(*) from public.certification_review_operations where submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}'))+
    (select count(*) from public.fan_score_ledger where manual_submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}'))+
    (select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id in ('${approveApproveSubmission}','${approveRejectSubmission}'))+
    (select count(*) from public.certification_uploads where mission_id in ('${approveApproveMission}','${approveRejectMission}') or consumed_submission_id in ('${approveApproveSubmission}','${approveRejectSubmission}'))+
    (select count(*) from public.certification_submissions where id in ('${approveApproveSubmission}','${approveRejectSubmission}') or mission_id in ('${approveApproveMission}','${approveRejectMission}'))+
    (select count(*) from public.certification_reward_revisions where id in ('${approveApproveReward}','${approveRejectReward}') or mission_id in ('${approveApproveMission}','${approveRejectMission}'))+
    (select count(*) from public.certification_missions where id in ('${approveApproveMission}','${approveRejectMission}')) as count
), orphaned as (
  select (select count(*) from public.certification_reward_revisions r left join public.certification_missions m on m.id=r.mission_id where m.id is null)+
    (select count(*) from public.certification_submissions s left join public.certification_missions m on m.id=s.mission_id left join public.certification_reward_revisions r on r.id=s.reward_revision_id and r.mission_id=s.mission_id where m.id is null or r.id is null)+
    (select count(*) from public.certification_uploads u left join public.certification_missions m on m.id=u.mission_id left join public.certification_submissions s on s.id=u.consumed_submission_id where m.id is null or (u.consumed_submission_id is not null and s.id is null))+
    (select count(*) from public.certification_review_operations o left join public.certification_submissions s on s.id=o.submission_id where s.id is null)+
    (select count(*) from public.fan_score_ledger l left join public.certification_submissions s on s.id=l.manual_submission_id where l.manual_submission_id is not null and s.id is null)+
    (select count(*) from public.fan_ticket_ledger l left join public.certification_submissions s on s.id=l.source_id where l.source_type='manual_certification' and s.id is null) as count
)
select fixture_residue.count||':'||orphaned.count from fixture_residue,orphaned;`;

function assertSingleWinner(label, outcomes) {
  const winners = outcomes.filter((outcome) => outcome.code === 0);
  if (winners.length !== 1) {
    throw new Error(`${label}: expected one successful review, got ${winners.length}\n${outcomes.map((outcome) => outcome.stderr).join('\n')}`);
  }
  return winners[0];
}

try {
  const behavioral = await readFile(new URL('../supabase/tests/fan_certifications.sql', import.meta.url), 'utf8');
  run(behavioral);
  run(setup + rewardAndSubmissionSetup);

  const approveApprove = await Promise.all([
    runSession(review(approveApproveSubmission, ids.approveApprove.correlationA, ids.approveApprove.operationA, 'approve')),
    runSession(review(approveApproveSubmission, ids.approveApprove.correlationB, ids.approveApprove.operationB, 'approve')),
  ]);
  assertSingleWinner('approve/approve', approveApprove);
  if (run(`select status||':'||(select count(*) from public.fan_score_ledger where manual_submission_id='${approveApproveSubmission}')||':'||(select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id='${approveApproveSubmission}') from public.certification_submissions where id='${approveApproveSubmission}';`) !== 'approved:1:1') {
    throw new Error('approve/approve did not settle to one approval and one of each reward row');
  }

  const approveReject = await Promise.all([
    runSession(review(approveRejectSubmission, ids.approveReject.correlationA, ids.approveReject.operationA, 'approve')),
    runSession(review(approveRejectSubmission, ids.approveReject.correlationB, ids.approveReject.operationB, 'reject')),
  ]);
  const winner = assertSingleWinner('approve/reject', approveReject);
  const expectedStatus = winner.stdout.includes('approved') ? 'approved' : 'rejected';
  const settled = run(`select status||':'||(select count(*) from public.fan_score_ledger where manual_submission_id='${approveRejectSubmission}')||':'||(select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id='${approveRejectSubmission}') from public.certification_submissions where id='${approveRejectSubmission}';`);
  const expectedSettlement = expectedStatus === 'approved' ? 'approved:1:1' : 'rejected:0:0';
  if (settled !== expectedSettlement) throw new Error(`approve/reject settled as ${settled}; expected ${expectedSettlement}`);

  console.log('PASS: certification behavior plus 2-session approve/approve and approve/reject serialization');
} finally {
  run(cleanup);
  const cleanupState = run(verifyCleanup);
  if (cleanupState !== '0:0') throw new Error(`Fixture cleanup verification failed: ${cleanupState}`);
}
