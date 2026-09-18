create table public.telegram_bug_reports (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  telegram_update_id bigint not null,
  update_kind text not null check (update_kind in ('message', 'edited_message')),
  message_sent_at timestamptz not null,
  message_edited_at timestamptz,
  sender jsonb not null default '{}'::jsonb check (jsonb_typeof(sender) = 'object'),
  report_text text,
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  reply_to_message_id bigint,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completion_commit text,
  completion_deployment_url text,
  completion_reaction text,
  completed_at timestamptz,
  last_completion_error text,
  received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint telegram_bug_reports_room check (telegram_chat_id = -5187701508),
  constraint telegram_bug_reports_message_unique unique (telegram_chat_id, telegram_message_id),
  constraint telegram_bug_reports_update_unique unique (telegram_update_id),
  constraint telegram_bug_reports_completion_consistent check (
    (status = 'pending' and completed_at is null)
    or
    (status = 'completed' and completion_commit is not null and completion_deployment_url is not null and completion_reaction = '👌' and completed_at is not null)
  )
);

create index telegram_bug_reports_pending_received_idx
  on public.telegram_bug_reports (received_at asc)
  where status = 'pending';

alter table public.telegram_bug_reports enable row level security;
alter table public.telegram_bug_reports force row level security;
revoke all on table public.telegram_bug_reports from public, anon, authenticated;
grant select, insert, update on table public.telegram_bug_reports to service_role;

create or replace function public.ingest_telegram_bug_report(
  p_telegram_update_id bigint,
  p_telegram_message_id bigint,
  p_telegram_chat_id bigint,
  p_update_kind text,
  p_message_sent_at timestamptz,
  p_message_edited_at timestamptz,
  p_sender jsonb,
  p_report_text text,
  p_media jsonb,
  p_reply_to_message_id bigint
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_telegram_chat_id <> -5187701508 then
    raise exception 'telegram bug report room is not allowed';
  end if;
  if p_update_kind not in ('message', 'edited_message') then
    raise exception 'telegram update kind is not supported';
  end if;
  if jsonb_typeof(coalesce(p_sender, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_media, '[]'::jsonb)) <> 'array' then
    raise exception 'telegram bug report metadata is invalid';
  end if;

  insert into public.telegram_bug_reports (
    telegram_chat_id,
    telegram_message_id,
    telegram_update_id,
    update_kind,
    message_sent_at,
    message_edited_at,
    sender,
    report_text,
    media,
    reply_to_message_id
  ) values (
    p_telegram_chat_id,
    p_telegram_message_id,
    p_telegram_update_id,
    p_update_kind,
    p_message_sent_at,
    p_message_edited_at,
    coalesce(p_sender, '{}'::jsonb),
    nullif(p_report_text, ''),
    coalesce(p_media, '[]'::jsonb),
    p_reply_to_message_id
  )
  on conflict (telegram_chat_id, telegram_message_id) do update
  set telegram_update_id = excluded.telegram_update_id,
      update_kind = excluded.update_kind,
      message_sent_at = excluded.message_sent_at,
      message_edited_at = excluded.message_edited_at,
      sender = excluded.sender,
      report_text = excluded.report_text,
      media = excluded.media,
      reply_to_message_id = excluded.reply_to_message_id,
      updated_at = clock_timestamp()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_telegram_bug_reports(
  p_status text default 'pending',
  p_limit integer default 20
) returns setof public.telegram_bug_reports
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('pending', 'completed', 'all') then
    raise exception 'telegram bug report status is invalid';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'telegram bug report limit is invalid';
  end if;

  return query
  select report.*
  from public.telegram_bug_reports report
  where p_status = 'all' or report.status = p_status
  order by report.received_at desc
  limit p_limit;
end;
$$;

create or replace function public.get_telegram_bug_report(
  p_telegram_chat_id bigint,
  p_telegram_message_id bigint
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select to_jsonb(report)
  from public.telegram_bug_reports report
  where report.telegram_chat_id = p_telegram_chat_id
    and report.telegram_message_id = p_telegram_message_id;
$$;

create or replace function public.complete_telegram_bug_report(
  p_telegram_chat_id bigint,
  p_telegram_message_id bigint,
  p_commit text,
  p_deployment_url text,
  p_reaction text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_telegram_chat_id <> -5187701508
     or p_commit !~ '^[0-9a-f]{7,40}$'
     or p_deployment_url !~ '^https://'
     or p_reaction <> '👌' then
    raise exception 'telegram bug report completion is invalid';
  end if;

  update public.telegram_bug_reports
  set status = 'completed',
      completion_commit = p_commit,
      completion_deployment_url = p_deployment_url,
      completion_reaction = p_reaction,
      completed_at = coalesce(completed_at, clock_timestamp()),
      last_completion_error = null,
      updated_at = clock_timestamp()
  where telegram_chat_id = p_telegram_chat_id
    and telegram_message_id = p_telegram_message_id
    and status = 'pending';

  if found then return true; end if;
  return exists (
    select 1
    from public.telegram_bug_reports
    where telegram_chat_id = p_telegram_chat_id
      and telegram_message_id = p_telegram_message_id
      and status = 'completed'
  );
end;
$$;

create or replace function public.record_telegram_bug_report_completion_error(
  p_telegram_chat_id bigint,
  p_telegram_message_id bigint,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.telegram_bug_reports
  set last_completion_error = left(p_error, 240),
      updated_at = clock_timestamp()
  where telegram_chat_id = p_telegram_chat_id
    and telegram_message_id = p_telegram_message_id
    and status = 'pending';
  return found;
end;
$$;

revoke all on function public.ingest_telegram_bug_report(bigint,bigint,bigint,text,timestamptz,timestamptz,jsonb,text,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.list_telegram_bug_reports(text,integer) from public, anon, authenticated;
revoke all on function public.get_telegram_bug_report(bigint,bigint) from public, anon, authenticated;
revoke all on function public.complete_telegram_bug_report(bigint,bigint,text,text,text) from public, anon, authenticated;
revoke all on function public.record_telegram_bug_report_completion_error(bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.ingest_telegram_bug_report(bigint,bigint,bigint,text,timestamptz,timestamptz,jsonb,text,jsonb,bigint) to service_role;
grant execute on function public.list_telegram_bug_reports(text,integer) to service_role;
grant execute on function public.get_telegram_bug_report(bigint,bigint) to service_role;
grant execute on function public.complete_telegram_bug_report(bigint,bigint,text,text,text) to service_role;
grant execute on function public.record_telegram_bug_report_completion_error(bigint,bigint,text) to service_role;
