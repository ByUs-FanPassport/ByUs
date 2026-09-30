import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { keccak256, toBytes } from "viem";
import { readEnvironmentFile } from "./local-production-env.mjs";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "./local-development-env.mjs";

// Real Dev RPCs, with every fan action rolled back before a mint/email worker can observe it.
const env = await readEnvironmentFile(".env.supabase.local");
assert.equal(new URL(env.SUPABASE_DEV_URL).hostname, `${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`);
const registration = JSON.parse(await readFile("outputs/nchive-assets/dev-registration.json", "utf8"));
assert.equal(registration.project, DEVELOPMENT_SUPABASE_PROJECT_REF);
for (const key of ["celebrityId", "liveId", "benefitId", "campaignId"]) assert.match(registration[key], /^[0-9a-f-]{36}$/i);
const fan = randomUUID(), stamp = randomUUID(), reservationStamp = randomUUID(), outsider = randomUUID();
const passportKey = `byus:passport:v1:${fan}:nchive`, stampKey = `byus:stamp:v1:${stamp}`, reservationKey = `byus:stamp:v1:${reservationStamp}`;
const hash = (value) => keccak256(toBytes(value));
const sql = `
begin;
set local statement_timeout='20s';
insert into public.app_users(id,privy_user_id,verified_email,status) values
 ('${fan}','did:privy:nchive-test-${fan}','${fan}@example.test','active'),
 ('${outsider}','did:privy:nchive-test-${outsider}','${outsider}@example.test','active');
insert into public.user_wallets(app_user_id,chain_id,address) values
 ('${fan}',91342,'0x${fan.replaceAll("-", "")}00000000');
do $$
declare attempt uuid; answer record; first_result jsonb; replay jsonb;
  entry_key uuid:=extensions.gen_random_uuid(); balance_before bigint; balance_after bigint;
begin
  -- A fan without certification cannot reserve.
  begin
    perform public.reserve_owned_live_event('${outsider}','${registration.liveId}',extensions.gen_random_uuid(),'${reservationStamp}','${reservationKey}','${hash(reservationKey)}');
    raise exception 'ASSERT_UNVERIFIED_RESERVATION_ACCEPTED';
  exception when others then
    if sqlerrm<>'G3_PASSPORT_REQUIRED' then raise; end if;
  end;
  perform public.start_owned_quiz_attempt_v2('${fan}','nchive',extensions.gen_random_uuid(),'creator_page','${registration.celebrityId}');
  select id into strict attempt from public.quiz_attempts where app_user_id='${fan}' and status='open';
  for answer in select q.id as question_id,o.id as option_id from public.quiz_attempt_questions q
    join public.quiz_attempt_options o on o.attempt_question_id=q.id and o.is_correct where q.attempt_id=attempt
  loop
    perform public.save_owned_quiz_answer('${fan}',attempt,answer.question_id,answer.option_id);
  end loop;
  perform public.submit_owned_quiz_attempt('${fan}',attempt,'${stamp}','${passportKey}','${hash(passportKey)}','${stampKey}','${hash(stampKey)}');
  assert exists(select 1 from public.fan_passports where app_user_id='${fan}' and celebrity_id='${registration.celebrityId}'), 'passport missing';
  assert (select status::text='passed' from public.quiz_attempts where id=attempt), 'quiz not passed';
  balance_before:=public.get_fan_ticket_balance('${fan}','${registration.celebrityId}');
  assert balance_before>0, 'quiz ticket missing';
  perform public.submit_owned_quiz_attempt('${fan}',attempt,'${stamp}','${passportKey}','${hash(passportKey)}','${stampKey}','${hash(stampKey)}');
  assert balance_before=public.get_fan_ticket_balance('${fan}','${registration.celebrityId}'), 'duplicate quiz reward';
  first_result:=public.reserve_owned_live_event('${fan}','${registration.liveId}',entry_key,'${reservationStamp}','${reservationKey}','${hash(reservationKey)}');
  balance_after:=public.get_fan_ticket_balance('${fan}','${registration.celebrityId}');
  assert balance_after>balance_before, 'reservation ticket missing';
  replay:=public.reserve_owned_live_event('${fan}','${registration.liveId}',entry_key,'${reservationStamp}','${reservationKey}','${hash(reservationKey)}');
  assert first_result->>'reservationId'=replay->>'reservationId', 'reservation replay differs';
  assert balance_after=public.get_fan_ticket_balance('${fan}','${registration.celebrityId}'), 'duplicate reservation reward';
  entry_key:=extensions.gen_random_uuid();
  first_result:=public.enter_owned_benefit('${fan}','${registration.benefitId}',entry_key,1,now());
  assert (first_result->>'resultingBalance')::bigint=balance_after-1, 'raffle debit wrong';
  replay:=public.enter_owned_benefit('${fan}','${registration.benefitId}',entry_key,1,now());
  assert first_result->>'entryId'=replay->>'entryId' and (replay->>'replayed')::boolean, 'raffle replay differs';
  assert public.get_fan_ticket_balance('${fan}','${registration.celebrityId}')=balance_after-1, 'duplicate raffle debit';
  begin
    perform public.enter_owned_benefit('${fan}','${registration.benefitId}',extensions.gen_random_uuid(),10,now());
    raise exception 'ASSERT_INSUFFICIENT_BALANCE_ACCEPTED';
  exception when others then
    if sqlerrm<>'PHASE1_TICKET_NEGATIVE_BALANCE' then raise; end if;
  end;
  begin
    perform public.enter_owned_benefit('${fan}','${registration.benefitId}',extensions.gen_random_uuid(),1,
      (select entry_closes_at from public.live_benefit_campaigns where id='${registration.campaignId}'));
    raise exception 'ASSERT_CLOSED_RAFFLE_ACCEPTED';
  exception when others then
    if sqlerrm<>'PHASE4_BENEFIT_ENTRY_WINDOW_CLOSED' then raise; end if;
  end;
  assert (select count(*)=1 from public.live_reservations where app_user_id='${fan}'), 'reservation count';
  assert (select count(*)=1 from public.benefit_ticket_entries where app_user_id='${fan}'), 'entry count';
end $$;
set constraints all immediate;
rollback;
select 'PASS: quiz, passport, rewards, reservation, raffle debit, retries, insufficient tickets, closing boundary; fan writes rolled back';
`;
const result = spawnSync(process.env.PSQL_BIN ?? "psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], {
  input: sql, encoding: "utf8", env: { ...process.env,
    PGHOST: "aws-1-ap-northeast-2.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres",
    PGUSER: `postgres.${DEVELOPMENT_SUPABASE_PROJECT_REF}`, PGPASSWORD: env.SUPABASE_DEV_DB_PASSWORD,
    PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10",
  },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr.replaceAll(env.SUPABASE_DEV_DB_PASSWORD, "[redacted]"));
console.log(result.stdout.trim());
