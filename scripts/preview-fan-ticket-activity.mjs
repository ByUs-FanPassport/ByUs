// Read-only production/dev impact report. Never executes migrations or payouts.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const target = args[0];
if (!['prod', 'dev'].includes(target) || args.length !== 2) {
  throw Error('Usage: node scripts/preview-fan-ticket-activity.mjs prod|dev /absolute/path/to/env');
}
const env = parseEnv(readFileSync(args[1], 'utf8'));
const prefix = `SUPABASE_${target.toUpperCase()}`;
const ref = env[`${prefix}_PROJECT_REF`];
const password = env[`${prefix}_DB_PASSWORD`];
if (!ref || !/^[a-z0-9]+$/.test(ref) || !password) throw Error('Missing database connection configuration');
function query(sql) {
  const r = spawnSync('psql', [
    `host=aws-1-ap-northeast-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.${ref} sslmode=require connect_timeout=10`,
    '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8', env: { ...process.env, PGPASSWORD: password, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000' } });
  if (r.status !== 0) throw Error(`Read-only report failed: ${r.stderr.replaceAll(password, '[redacted]')}`);
  return r.stdout.trim();
}
const migration = readFileSync(new URL('../supabase/migrations/20260915144143_fan_ticket_activity_rewards.sql', import.meta.url), 'utf8');
const match = migration.match(/create function public\.fan_ticket_activity_sources\([\s\S]*?as \$\$\n([\s\S]*?)\n\$\$;/);
if (!match) throw Error('Canonical source query not found');
const installed = query("select to_regclass('public.fan_ticket_activity_awards') is not null;") === 't';
let sources = match[1].replace(/;\s*$/, '').replaceAll('p_owner', 'null::uuid').replaceAll('p_creator', 'null::uuid');
if (!installed) {
  sources = sources.replace(' join public.fan_ticket_activity_policy p on p.celebrity_id=c.id', '')
    .replace('where p.enabled and', "where c.slug in ('elina','changha','yuna') and");
}
const processed = installed ? `and not exists(select 1 from public.fan_ticket_activity_awards a where a.app_user_id=x.app_user_id and a.celebrity_id=x.celebrity_id and a.action_key=x.action_key and a.scope_key=x.scope_key)` : '';
const report = query(`
with sources as (${sources}), pending as (
 select x.*,exists(select 1 from public.fan_ticket_ledger l where l.app_user_id=x.app_user_id and l.celebrity_id=x.celebrity_id
  and l.source_id=x.source_id and l.entry_kind='credit'
  and ((x.action_key='verification' and l.source_type='passport_verification')
    or (x.action_key like 'membership_%' and l.source_type='manual_certification'))) already_paid
 from sources x where true ${processed}
), groups as (
 select c.slug,x.action_key,count(*) records,count(*) filter(where already_paid) already_paid,count(*) filter(where not already_paid) tickets_to_pay
 from pending x join public.celebrities c on c.id=x.celebrity_id group by c.slug,x.action_key order by c.slug,x.action_key
), legacy as (
 select c.slug,l.source_type,count(*) records,sum(l.amount) amount
 from public.fan_ticket_ledger l join public.celebrities c on c.id=l.celebrity_id
 where c.slug in ('elina','changha','yuna') group by c.slug,l.source_type order by c.slug,l.source_type
)
select jsonb_pretty(jsonb_build_object('readOnly',true,'asOf',now(),'policyInstalled',${installed},
 'pending',coalesce((select jsonb_agg(g) from groups g),'[]'::jsonb),
 'ticketsToPay',(select count(*) from pending where not already_paid),
 'existingLedgerBySource',coalesce((select jsonb_agg(l) from legacy l),'[]'::jsonb),
 'inactiveOwnersExcluded',(select count(distinct u.id) from public.app_users u where u.status<>'active' and
  exists(select 1 from public.fan_passports p join public.celebrities c on c.id=p.celebrity_id where p.app_user_id=u.id and c.slug in ('elina','changha','yuna')))));
`);
console.log(report);
