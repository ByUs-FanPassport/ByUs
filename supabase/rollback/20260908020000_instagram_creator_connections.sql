-- Manual rollback for the additive Instagram migration; not executed automatically.
-- Disable collection first and explicitly authorize erasure of all Instagram data.
begin;
drop function if exists public.instagram_finish_sync(uuid,uuid,uuid,jsonb);
drop function if exists public.instagram_claim_sync(integer,uuid);
drop function if exists public.instagram_delete_subject(text,timestamptz,text);
drop function if exists public.instagram_disconnect(uuid,uuid);
drop function if exists public.instagram_transition(text,text,text,jsonb);
drop function if exists public.instagram_issue_invite(uuid,text,text,text);
drop table if exists public.instagram_connection_flows;
drop table if exists public.instagram_connections;
drop table if exists public.instagram_deletion_receipts;
drop table if exists public.instagram_revocations;
delete from supabase_migrations.schema_migrations where version='20260908020000';
commit;
