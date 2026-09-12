// Uses only a disposable local database; never reads production credentials.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = new URL(process.env.INSTAGRAM_TEST_PG_URL ?? 'postgresql://ig_test@127.0.0.1:56487/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(root.hostname) || root.username !== 'ig_test') throw Error('Local ig_test database required');
const database = `ig_live_${randomUUID().replaceAll('-', '')}`;
const rootUrl = root.toString(); root.pathname = `/${database}`; const url = root.toString();
function sql(input, target = url) {
  const r = spawnSync('psql', [target, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr); return r.stdout.trim();
}
try {
  sql(`create database ${database}`, rootUrl);
  sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
    create schema extensions; create extension pgcrypto with schema extensions;
    create table public.celebrities(id uuid primary key,slug text unique,status text default 'draft');
    create table public.celebrity_localizations(celebrity_id uuid,locale text,name text);
    create table public.celebrity_social_links(celebrity_id uuid,platform text,url text,active boolean,primary key(celebrity_id,platform));
    create table public.live_events(celebrity_id uuid,publication_status text,live_provider text,starts_at timestamptz,ends_at timestamptz,external_live_url text);
    grant usage on schema public,extensions to anon,authenticated,service_role;
    grant select on public.celebrities,public.celebrity_localizations,public.celebrity_social_links,public.live_events to service_role;`);
  for (const path of ['supabase/migrations/20260908020000_instagram_creator_connections.sql', 'supabase/migrations/20260912120819_instagram_live_observations.sql', 'supabase/tests/instagram_live_observations.sql']) sql(await readFile(path, 'utf8'));
  console.log('PASS: isolated PostgreSQL LIVE claims, leases, generation/token races, ACL, identity/profile checks, freshness, erasure, whitelist, and offline/error fallback');
} finally { sql(`drop database if exists ${database} with (force)`, rootUrl); }
