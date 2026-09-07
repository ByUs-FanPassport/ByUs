// PostgreSQL integration/concurrency checks in a disposable LOCAL database only.
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = new URL(process.env.INSTAGRAM_TEST_PG_URL ?? 'postgresql://ig_test@127.0.0.1:56487/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(root.hostname) || root.username !== 'ig_test') throw Error('Only an isolated local ig_test PostgreSQL cluster is allowed');
const database = `ig_verify_${randomUUID().replaceAll('-', '')}`;
const rootUrl = root.toString();
root.pathname = `/${database}`;
const url = root.toString();
function psql(sql, target = url) {
  const result = spawnSync('psql', [target, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
  return result.stdout.trim();
}
function concurrent(sql) {
  const child = spawn('psql', [url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']);
  let stdout = '', stderr = '';
  let resolveLocked;
  const locked = new Promise((resolve) => { resolveLocked = resolve; });
  child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.includes('LOCKED')) resolveLocked(); });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (code) => { resolveLocked(); resolve({ code, stdout, stderr }); }));
  child.stdin.end(sql);
  return { locked, done };
}
const id = '11111111-1111-4111-8111-111111111111';
const subject = '102000000000003';
const payload = `jsonb_build_object('next_hash',repeat('d',64),'identity',jsonb_build_object('id','${subject}','user_id','178400000000003','username','creator_test','account_type','BUSINESS'),'token_ciphertext','v1.test.encrypted.value','token_issued_at',now(),'token_expires_at',now()+interval '60 days')`;
const start = `select public.instagram_issue_invite('${id}',repeat('a',64),'creator_test',null); select public.instagram_transition('start',repeat('a',64),repeat('b',64),jsonb_build_object('next_hash',repeat('c',64))); select public.instagram_transition('consume',repeat('c',64),repeat('b',64));`;
const pending = `select public.instagram_transition('pending',repeat('c',64),repeat('b',64),${payload});`;
const confirm = `select public.instagram_transition('confirm',repeat('d',64),repeat('b',64));`;
const clear = `select public.instagram_disconnect('${id}'); delete from public.instagram_revocations;`;
const subjectLock = `select pg_advisory_xact_lock(hashtextextended('${subject}',8092026)); select 'LOCKED'; select pg_sleep(0.25);`;
try {
  psql(`create database ${database};`, rootUrl);
  psql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create schema extensions; create extension pgcrypto with schema extensions; create table public.celebrities(id uuid primary key,slug text unique,status text default 'draft'); create table public.celebrity_localizations(celebrity_id uuid references public.celebrities(id),locale text,name text,primary key(celebrity_id,locale)); grant usage on schema public,extensions to anon,authenticated,service_role; grant select on public.celebrities,public.celebrity_localizations to service_role;`);
  psql(await readFile(new URL('../supabase/migrations/20260908020000_instagram_creator_connections.sql', import.meta.url), 'utf8'));
  psql(await readFile(new URL('../supabase/tests/instagram_connections.sql', import.meta.url), 'utf8'));
  psql(`insert into public.celebrities(id,slug,status) values('${id}','ig-concurrency','published');`);
  // Pending wins subject lock; deletion must then erase that newly identifiable flow.
  psql(start);
  const first = concurrent(`begin;set local role service_role;${subjectLock}${pending}commit;`);
  await first.locked;
  const deletion = concurrent(`set role service_role;select public.instagram_delete_subject('${subject}',clock_timestamp()+interval '1 second',repeat('e',64));`);
  const outcomes = await Promise.all([first.done, deletion.done]);
  if (outcomes.some((result) => result.code !== 0)) throw Error('Pending/deletion concurrency failed');
  if (psql('select count(*) from public.instagram_connection_flows;') !== '0') throw Error('Deletion did not erase in-flight pending');
  // Deletion wins the subject lock; the subsequently completed exchange must fail.
  psql(clear + start);
  const second = concurrent(`begin;set local role service_role;${subjectLock}select public.instagram_delete_subject('${subject}',clock_timestamp()+interval '1 second',repeat('f',64));commit;`);
  await second.locked;
  const latePending = concurrent(`set role service_role;${pending}`);
  const reversed = await Promise.all([second.done, latePending.done]);
  if (reversed[0].code !== 0 || reversed[1].code === 0 || !reversed[1].stderr.includes('Instagram authorization revoked')) throw Error('Late pending bypassed revocation');
  // A single confirmation wins, even when two browser requests arrive together.
  psql(clear + start + pending);
  const confirmations = await Promise.all([concurrent(`set role service_role;${confirm}`).done, concurrent(`set role service_role;${confirm}`).done]);
  if (confirmations.filter((result) => result.code === 0).length !== 1) throw Error('Confirmation was not single-use');
  // Confirm holds slot lock first; a concurrent explicit disconnect must still win last.
  psql(clear + start + pending);
  const lockedConfirm = concurrent(`begin;set local role service_role;select celebrity_id from public.instagram_connections where celebrity_id='${id}' for update;select 'LOCKED';select pg_sleep(0.25);${confirm}commit;`);
  await lockedConfirm.locked;
  const disconnect = concurrent(`set role service_role;select public.instagram_disconnect('${id}');`);
  if ((await Promise.all([lockedConfirm.done, disconnect.done])).some((result) => result.code !== 0)) throw Error('Concurrent disconnect failed');
  if (psql(`select token_ciphertext is null and identity is null and media='[]'::jsonb from public.instagram_connections where celebrity_id='${id}';`) !== 't') throw Error('Concurrent confirm restored disconnected data');
  console.log('PASS: PostgreSQL migration, lifecycle, access grants, delayed deletion, new authorization protection, and 4 concurrent schedules');
} finally {
  psql(`drop database if exists ${database} with (force);`, rootUrl);
}
