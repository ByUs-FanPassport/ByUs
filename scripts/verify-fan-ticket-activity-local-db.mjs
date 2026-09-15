// Uses a fresh disposable PostgreSQL cluster and never reads production credentials.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url);
const cluster = await mkdtemp(join(tmpdir(), 'byus-ticket-activity-'));
const data = join(cluster, 'data');
const log = join(cluster, 'postgres.log');
const socket = join(cluster, 'socket');
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const postgres = `postgresql://127.0.0.1:${port}/postgres`;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${name} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sql(input, allowError = false) {
  const result = spawnSync('psql', [postgres, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input,
    encoding: 'utf8',
  });
  if (!allowError && result.status !== 0) throw new Error(result.stderr);
  return allowError ? result : result.stdout.trim();
}

function parallel(input) {
  return new Promise((resolve) => {
    const child = spawn('psql', [postgres, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr }));
    child.stdin.end(input);
  });
}

function check(value, message) {
  if (!value) throw new Error(message);
}

let started = false;
try {
  command('initdb', ['-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8']);
  command('mkdir', ['-p', socket]);
  command('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, 'start']);
  started = true;

  sql(`
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create type public.social_platform as enum ('youtube','tiktok','instagram');
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public,extensions to anon,authenticated,service_role;

    create table public.app_users(id uuid primary key,status text not null);
    create table public.celebrities(id uuid primary key,slug text unique not null,status text not null,archived_at timestamptz);
    create table public.celebrity_localizations(celebrity_id uuid,locale text,name text,primary key(celebrity_id,locale));
    create table public.reward_policy_versions(version integer primary key);
    create table public.reward_policy_activation(singleton boolean primary key,policy_version integer not null references public.reward_policy_versions(version));
    create table public.audit_logs(
      id uuid primary key default extensions.gen_random_uuid(),
      actor_app_user_id uuid,
      actor_admin_allowlist_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      correlation_id uuid not null,
      before_after_summary jsonb not null,
      created_at timestamptz not null default now()
    );
    create table public.quiz_verification_attributions(attempt_id uuid primary key,source_type text,source_id uuid);
    create table public.quiz_pass_attributions(quiz_pass_id uuid primary key,attempt_id uuid,source_type text,source_id uuid);
    create table public.quiz_passes(id uuid primary key,app_user_id uuid not null references public.app_users(id),celebrity_id uuid not null references public.celebrities(id),winning_attempt_id uuid not null unique,passed_at timestamptz not null,unique(app_user_id,celebrity_id));
    create table public.fan_passports(id uuid primary key,app_user_id uuid not null,celebrity_id uuid not null,unique(app_user_id,celebrity_id));
    create table public.fan_reactions(id uuid primary key,app_user_id uuid not null,celebrity_id uuid not null,completed_at timestamptz not null);
    create table public.fan_lounge_messages(id uuid primary key,app_user_id uuid not null,celebrity_id uuid not null,created_at timestamptz not null);
    create table public.celebrity_notices(id uuid primary key,celebrity_id uuid not null);
    create table public.celebrity_notice_comments(id uuid primary key,app_user_id uuid not null,notice_id uuid not null,created_at timestamptz not null);
    create table public.community_stamps(id uuid primary key,app_user_id uuid not null,celebrity_id uuid not null,kind text not null,source_key text not null,issued_at timestamptz not null);
    create table public.certification_submissions(id uuid primary key,app_user_id uuid not null,celebrity_id uuid not null,status text not null,membership_platform public.social_platform,reviewed_at timestamptz);
    create table public.community_stamp_share_links(id uuid primary key,owner_app_user_id uuid not null,celebrity_id uuid not null);
    create table public.community_stamp_share_visits(id uuid primary key,share_link_id uuid not null,visitor_app_user_id uuid not null,visited_at timestamptz not null);
    create table public.benefit_ticket_entries(id uuid primary key,benefit_id uuid not null,ticket_ledger_id uuid unique not null);
    create table public.benefit_localizations(benefit_id uuid,locale text,title text,primary key(benefit_id,locale));

    create function public.community_stamp_kst_date(p_now timestamptz default now()) returns date
      language sql stable set search_path='' as $$ select (p_now at time zone 'Asia/Seoul')::date $$;
    create function public.assert_certification_admin(p_actor uuid,p_allowlist uuid) returns void
      language plpgsql stable security definer set search_path='' as $$ begin
        if p_actor<>'00000000-0000-0000-0000-000000000090' or p_allowlist<>'00000000-0000-0000-0000-000000000091' then
          raise exception 'CERTIFICATION_ADMIN_FORBIDDEN';
        end if;
      end $$;

    insert into public.app_users values
      ('00000000-0000-0000-0000-000000000001','active'),
      ('00000000-0000-0000-0000-000000000002','active'),
      ('00000000-0000-0000-0000-000000000003','active'),
      ('00000000-0000-0000-0000-000000000004','active'),
      ('00000000-0000-0000-0000-000000000005','disabled'),
      ('00000000-0000-0000-0000-000000000090','active');
    insert into public.celebrities values
      ('10000000-0000-0000-0000-000000000001','elina','published',null),
      ('10000000-0000-0000-0000-000000000002','changha','published',null),
      ('10000000-0000-0000-0000-000000000003','yuna','published',null),
      ('10000000-0000-0000-0000-000000000004','other','published',null),
      ('10000000-0000-0000-0000-000000000005','archived','published',now());
    insert into public.celebrity_localizations select id,'ko',initcap(slug) from public.celebrities;
    insert into public.reward_policy_versions values(1);
    insert into public.reward_policy_activation values(true,1);
  `);

  sql(await readFile(new URL('supabase/migrations/20260902012000_phase1_ticket_ledger.sql', repo), 'utf8'));
  sql(`
    create function public.reward_successful_quiz_pass() returns trigger
    language plpgsql security definer set search_path='' as $$
    declare attribution public.quiz_verification_attributions%rowtype; policy_version integer;
    begin
      select * into attribution from public.quiz_verification_attributions where attempt_id=new.winning_attempt_id;
      if found then insert into public.quiz_pass_attributions(quiz_pass_id,attempt_id,source_type,source_id)
        values(new.id,new.winning_attempt_id,attribution.source_type,attribution.source_id); end if;
      select a.policy_version into strict policy_version from public.reward_policy_activation a where a.singleton=true;
      perform public.post_fan_ticket_entry(new.app_user_id,new.celebrity_id,'credit',1,
        'passport_verification',new.id,new.id,policy_version,null,null);
      return new;
    end $$;
    create trigger quiz_passes_reward_and_attribute after insert on public.quiz_passes
      for each row execute function public.reward_successful_quiz_pass();

    -- Historical canonical credits and evidence exist before the activity migration.
    insert into public.quiz_passes values
      ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000002','2026-09-10 01:00+00');
    select public.post_fan_ticket_entry('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','debit',-1,'raffle_entry','22000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002',1,null,null);
    insert into public.certification_submissions values
      ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','approved','youtube','2026-09-10 02:00+00');
    select public.post_fan_ticket_entry('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','credit',1,'manual_certification','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,null,null);
    insert into public.fan_reactions values
      ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-09 04:00+00'),
      ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','2026-09-09 04:00+00');
    insert into public.community_stamps values
      ('41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','daily_checkin','daily:checkin:2026-09-10','2026-09-09 15:01+00');
  `);

  sql(await readFile(new URL('supabase/migrations/20260915144143_fan_ticket_activity_rewards.sql', repo), 'utf8'));
  sql(await readFile(new URL('supabase/tests/fan_ticket_activity_rewards.sql', repo), 'utf8'));

  for (const role of ['anon', 'authenticated']) {
    const denied = sql(`set role ${role}; select public.get_owned_fan_ticket_activity('00000000-0000-0000-0000-000000000001','elina',null,20,'ko');`, true);
    check(denied.status !== 0 && denied.stderr.includes('permission denied'), `${role} read RPC must be forbidden`);
  }
  check(JSON.parse(sql(`set role service_role; select public.get_owned_fan_ticket_activity('00000000-0000-0000-0000-000000000001','elina',null,1,'ko');`)).creator.slug === 'elina', 'service read requires and honors explicit owner');
  const forged = sql(`select public.post_fan_ticket_entry('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','credit',1,'fan_activity_reward','50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,null,null);`, true);
  check(forged.status !== 0 && forged.stderr.includes('TICKET_ACTIVITY_SOURCE_INVALID'), 'generic ledger RPC must not forge activity credit');
  check(sql(`select count(*) from public.fan_ticket_ledger where source_id='50000000-0000-0000-0000-000000000001'`) === '0', 'forged deferred credit rolled back');
  const immutable = sql(`update public.fan_ticket_activity_awards set backfill=false where id=(select id from public.fan_ticket_activity_awards limit 1);`, true);
  check(immutable.status !== 0 && immutable.stderr.includes('append-only'), 'activity receipts must be immutable');

  sql(`insert into public.fan_reactions values ('40000000-0000-0000-0000-000000000098','00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003',statement_timestamp());`);
  check(sql(`select backfill from public.fan_ticket_activity_awards where source_id='40000000-0000-0000-0000-000000000098'`) === 'f', 'post-activation live evidence is not backfill');

  // Race the same live award. The advisory scope lock must make exactly one call pay.
  sql(`
    alter table public.fan_reactions disable trigger zz_ticket_activity;
    insert into public.fan_reactions values
      ('40000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','2026-09-15 01:00+00');
    alter table public.fan_reactions enable trigger zz_ticket_activity;
  `);
  const awardRace = await Promise.all(Array.from({ length: 6 }, () => parallel(`
    select public.award_fan_ticket_activity(
      '00000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000003','reaction','once',false);
  `)));
  check(awardRace.every((result) => result.code === 0), `parallel award errors: ${awardRace.map((r) => r.stderr).join(' ')}`);
  check(awardRace.filter((result) => result.stdout === 't').length === 1, 'parallel award must pay once');
  check(sql(`select count(*)||':'||sum(amount) from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000003' and celebrity_id='10000000-0000-0000-0000-000000000003' and source_type='fan_activity_reward'`) === '1:1', 'parallel award ledger count');

  // Race backfills over the same pending set, then prove a small second batch drains it.
  sql(`
    alter table public.fan_lounge_messages disable trigger zz_ticket_activity;
    insert into public.fan_lounge_messages values
      ('42000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','2026-09-12 00:00+00'),
      ('42000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','2026-09-12 00:00+00');
    alter table public.fan_lounge_messages enable trigger zz_ticket_activity;
  `);
  const backfillRace = await Promise.all(Array.from({ length: 2 }, () => parallel(`
    set role service_role;
    select public.backfill_fan_ticket_activity('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000091',true,1);
  `)));
  check(backfillRace.every((result) => result.code === 0), `parallel backfill errors: ${backfillRace.map((r) => r.stderr).join(' ')}`);
  const firstBatchAwards = Number(sql(`select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000003' and action_key='comment'`));
  check(firstBatchAwards >= 1 && firstBatchAwards <= 2, 'parallel backfills must make bounded progress without duplication');
  const secondBatch = JSON.parse(sql(`set role service_role;select public.backfill_fan_ticket_activity('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000091',true,1);`));
  check(secondBatch.processed === 2 - firstBatchAwards && secondBatch.ticketsPaid === 2 - firstBatchAwards, 'second bounded batch should drain any remaining scope');
  check(sql(`select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000003' and action_key='comment'`) === '2', 'two batches should award both creator scopes');
  const drained = JSON.parse(sql(`set role service_role;select public.backfill_fan_ticket_activity('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000091',true,1);`));
  check(drained.processed === 0, 'drained backfill should find no remaining evidence');
  check(sql(`select count(*) from public.audit_logs where action='ticket.activity.backfill'`) === '5', 'every applied backfill call should be audited');

  console.log('PASS: 8 activity keys/6 action families, KST and historical backfill, canonical credit adoption after spend, membership state/platform snapshots, non-target exclusion, replay/deletion idempotency, parallel awards/backfills, ACL, and paginated reconciled history');
  console.log(`PostgreSQL log: ${log}`);
} finally {
  if (started) command('pg_ctl', ['-D', data, 'stop', '-m', 'fast']);
}
