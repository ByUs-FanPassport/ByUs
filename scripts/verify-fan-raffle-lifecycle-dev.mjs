import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const expectedDevRef = "xcppyedwusirqnfpbtit";
const connectionFingerprint = `${process.env.PGHOST ?? ""} ${process.env.PGUSER ?? ""}`;
if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !process.env.PGPASSWORD) {
  throw new Error("PGHOST, PGUSER, PGDATABASE, and PGPASSWORD are required");
}
if (!connectionFingerprint.includes(expectedDevRef)) {
  throw new Error(`RAFFLE_DEV_DATABASE_MISMATCH: expected ${expectedDevRef} in PGHOST or PGUSER`);
}
if (process.env.BYUS_RAFFLE_DEV_ALLOW_MUTATION !== "I_UNDERSTAND_LINKED_DEV_MUTATION") {
  throw new Error("RAFFLE_DEV_MUTATION_OPT_IN_REQUIRED");
}

const psql = process.env.PSQL_BIN ?? "psql";
const args = ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"];
const safeError = (value) => String(value).replaceAll(process.env.PGPASSWORD, "[redacted]").trim();

function run(sql) {
  const result = spawnSync(psql, args, { input: sql, encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(safeError(result.stderr));
  return result.stdout.trim();
}

function runSession(sql) {
  const child = spawn(psql, args, { env: process.env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(sql);
  return new Promise((resolve) => child.on("close", (code) => resolve({
    code,
    stdout: stdout.trim(),
    stderr: safeError(stderr),
  })));
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function assertSucceeded(label, outcomes) {
  const failed = outcomes.filter((outcome) => outcome.code !== 0);
  if (failed.length) throw new Error(`${label}: ${failed.map((outcome) => outcome.stderr).join("\n")}`);
}

const id = () => randomUUID();
const runKey = randomUUID().replaceAll("-", "").slice(0, 16);
const owner = id();
const admin = id();
const allowlist = id();
const celebrity = id();
const brand = id();
const lives = [id(), id(), id()];
const benefits = [id(), id(), id()];
const campaigns = [id(), id(), id()];
const emailChannel = id();
const entryKeys = [id(), id()];
const creditSource = id();
const creditKey = id();
const publishAt = "2099-01-02T00:00:01Z";

const setup = `
begin;
set local session_replication_role=replica;
insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('${owner}','did:privy:raffle-owner-${runKey}','raffle-owner-${runKey}@byus.test','active'),
  ('${admin}','did:privy:raffle-admin-${runKey}','raffle-admin-${runKey}@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('${allowlist}','raffle-admin-${runKey}@byus.test','admin',true);
insert into public.celebrities(id,slug,status,image_url,published_at)
  values('${celebrity}','raffle-${runKey}','published','/raffle-fixture.webp',pg_catalog.now());
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('${celebrity}','ko','Raffle Fixture','Raffle fixture','Raffle fixture'),
  ('${celebrity}','en','Raffle Fixture','Raffle fixture','Raffle fixture');
insert into public.brands(id,slug,status,logo_url,logo_alt,published_at)
  values('${brand}','raffle-${runKey}','published','/raffle-fixture.svg','Raffle fixture',pg_catalog.now());
insert into public.live_events(
  id,slug,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,
  reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,
  attendance_valid_from,attendance_valid_until,external_live_url
) values
  ('${lives[0]}','raffle-cancel-${runKey}','${celebrity}','${brand}','published','scheduled','2099-02-01','2099-02-02','2098-12-01','2098-12-31','https://youtu.be/rafflefixture','/raffle-fixture.webp',extensions.crypt('Raffle1234',extensions.gen_salt('bf',12)),pg_catalog.now(),'2099-02-01','2099-02-02','https://youtu.be/rafflefixture'),
  ('${lives[1]}','raffle-draw-${runKey}','${celebrity}','${brand}','published','scheduled','2099-02-03','2099-02-04','2098-12-01','2098-12-31','https://youtu.be/rafflefixture','/raffle-fixture.webp',extensions.crypt('Raffle1234',extensions.gen_salt('bf',12)),pg_catalog.now(),'2099-02-03','2099-02-04','https://youtu.be/rafflefixture'),
  ('${lives[2]}','raffle-cancel-draw-${runKey}','${celebrity}','${brand}','published','scheduled','2099-02-05','2099-02-06','2098-12-01','2098-12-31','https://youtu.be/rafflefixture','/raffle-fixture.webp',extensions.crypt('Raffle1234',extensions.gen_salt('bf',12)),pg_catalog.now(),'2099-02-05','2099-02-06','https://youtu.be/rafflefixture');
insert into public.benefits(
  id,slug,celebrity_id,publication_status,delivery_type,claim_opens_at,claim_closes_at,
  stock_limit,per_user_limit,minimum_score,minimum_level,published_at,reward_policy_version
) values
  ('${benefits[0]}','raffle-cancel-${runKey}','${celebrity}','published','text','2098-01-01','2100-01-01',10,1,0,'Bronze',pg_catalog.now(),(select policy_version from public.reward_policy_activation where singleton)),
  ('${benefits[1]}','raffle-draw-${runKey}','${celebrity}','published','text','2098-01-01','2100-01-01',10,1,0,'Bronze',pg_catalog.now(),(select policy_version from public.reward_policy_activation where singleton)),
  ('${benefits[2]}','raffle-cancel-draw-${runKey}','${celebrity}','published','text','2098-01-01','2100-01-01',10,1,0,'Bronze',pg_catalog.now(),(select policy_version from public.reward_policy_activation where singleton));
insert into public.live_benefit_campaigns(
  id,live_event_id,status,entry_opens_at,entry_closes_at,revision,
  actor_app_user_id,actor_admin_allowlist_id,published_at
) values
  ('${campaigns[0]}','${lives[0]}','published','2099-01-01','2099-01-02',1,'${admin}','${allowlist}',pg_catalog.now()),
  ('${campaigns[1]}','${lives[1]}','published','2099-01-01','2099-01-02',1,'${admin}','${allowlist}',pg_catalog.now()),
  ('${campaigns[2]}','${lives[2]}','published','2099-01-01','2099-01-02',1,'${admin}','${allowlist}',pg_catalog.now());
insert into public.live_benefit_campaign_items(
  campaign_id,benefit_id,priority,per_fan_ticket_limit,winner_quantity,fulfillment_method
) values
  ('${campaigns[0]}','${benefits[0]}',1,10,1,'digital'),
  ('${campaigns[1]}','${benefits[1]}',1,10,1,'physical_shipping'),
  ('${campaigns[2]}','${benefits[2]}',1,10,1,'digital');
select public.post_fan_ticket_entry(
  '${owner}','${celebrity}','credit',20,'raffle_dev_fixture','${creditSource}','${creditKey}',
  (select policy_version from public.reward_policy_activation where singleton),null,null
);
insert into public.push_subscriptions(id,app_user_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent)
  values('${id()}','${owner}','https://push.invalid/${runKey}',repeat('d',64),repeat('p',32),repeat('a',16),'raffle-dev-fixture');
insert into public.fan_notification_channels(
  id,app_user_id,kind,status,consent_version,consented_at,destination_fingerprint,
  destination_label,verified_at,priority
) values('${emailChannel}','${owner}','email','eligible','raffle-dev-v1',pg_catalog.now(),repeat('e',64),'r***@byus.test',pg_catalog.now(),100);
insert into public.fan_notification_channel_private(channel_id,destination)
  values('${emailChannel}','raffle-${runKey}@byus.test');
commit;`;

const cleanup = `
begin;
set local session_replication_role=replica;
delete from public.notification_delivery_test_sink where delivery_id in (
  select id from public.external_notification_delivery_outbox where notification_id in
    (select id from public.fan_notifications where app_user_id='${owner}'));
delete from public.external_notification_delivery_outbox where notification_id in
  (select id from public.fan_notifications where app_user_id='${owner}');
delete from public.notification_delivery_outbox where notification_id in
  (select id from public.fan_notifications where app_user_id='${owner}');
delete from public.notification_delivery_plans where notification_id in
  (select id from public.fan_notifications where app_user_id='${owner}');
delete from public.fan_notifications where app_user_id='${owner}';
delete from public.fan_notification_channel_private where channel_id in
  (select id from public.fan_notification_channels where app_user_id='${owner}');
delete from public.benefit_fulfillment_events where fulfillment_id in (
  select f.id from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id
  where w.campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]));
delete from public.benefit_recipient_private where winner_id in (
  select id from public.benefit_draw_winners where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]));
delete from public.benefit_fulfillments where winner_id in (
  select id from public.benefit_draw_winners where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]));
delete from public.benefit_draw_publications where draw_id in (
  select id from public.benefit_draws where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]));
delete from public.benefit_draw_secrets where draw_id in (
  select id from public.benefit_draws where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]));
delete from public.benefit_draw_candidates where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]);
delete from public.benefit_draw_winners where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]);
delete from public.benefit_draws where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]);
delete from public.benefit_entry_refunds where app_user_id='${owner}';
delete from public.benefit_ticket_entries where app_user_id='${owner}';
delete from public.fan_ticket_ledger where app_user_id='${owner}' and celebrity_id='${celebrity}';
delete from public.fan_product_events where app_user_id='${owner}' or celebrity_id='${celebrity}'
  or live_event_id=any(array['${lives[0]}'::uuid,'${lives[1]}'::uuid,'${lives[2]}'::uuid])
  or benefit_id=any(array['${benefits[0]}'::uuid,'${benefits[1]}'::uuid,'${benefits[2]}'::uuid]);
delete from public.live_benefit_campaign_items where campaign_id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]);
delete from public.live_benefit_campaigns where id=any(array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid]);
delete from public.benefit_localizations where benefit_id=any(array['${benefits[0]}'::uuid,'${benefits[1]}'::uuid,'${benefits[2]}'::uuid]);
delete from public.benefits where id=any(array['${benefits[0]}'::uuid,'${benefits[1]}'::uuid,'${benefits[2]}'::uuid]);
delete from public.live_event_localizations where live_event_id=any(array['${lives[0]}'::uuid,'${lives[1]}'::uuid,'${lives[2]}'::uuid]);
delete from public.live_events where id=any(array['${lives[0]}'::uuid,'${lives[1]}'::uuid,'${lives[2]}'::uuid]);
delete from public.fan_notification_channels where app_user_id='${owner}';
delete from public.push_subscriptions where app_user_id='${owner}';
delete from public.audit_logs where actor_app_user_id in ('${owner}','${admin}');
delete from public.brand_localizations where brand_id='${brand}';
delete from public.brands where id='${brand}';
delete from public.celebrity_localizations where celebrity_id='${celebrity}';
delete from public.celebrities where id='${celebrity}';
delete from public.admin_allowlist where id='${allowlist}';
delete from public.app_users where id in ('${owner}','${admin}');
commit;`;

const verifyCleanup = `
do $$
declare target record; remaining bigint;
begin
  for target in
    select table_schema,table_name,column_name
    from information_schema.columns
    where table_schema='public' and column_name in (
      'app_user_id','actor_app_user_id','owner_app_user_id','celebrity_id',
      'brand_id','live_event_id','benefit_id','campaign_id'
    )
  loop
    if target.column_name in ('app_user_id','actor_app_user_id','owner_app_user_id') then
      execute format('select count(*) from %I.%I where %I=any($1)',target.table_schema,target.table_name,target.column_name)
        into remaining using array['${owner}'::uuid,'${admin}'::uuid];
    elsif target.column_name='celebrity_id' then
      execute format('select count(*) from %I.%I where %I=$1',target.table_schema,target.table_name,target.column_name)
        into remaining using '${celebrity}'::uuid;
    elsif target.column_name='brand_id' then
      execute format('select count(*) from %I.%I where %I=$1',target.table_schema,target.table_name,target.column_name)
        into remaining using '${brand}'::uuid;
    elsif target.column_name='live_event_id' then
      execute format('select count(*) from %I.%I where %I=any($1)',target.table_schema,target.table_name,target.column_name)
        into remaining using array['${lives[0]}'::uuid,'${lives[1]}'::uuid,'${lives[2]}'::uuid];
    elsif target.column_name='benefit_id' then
      execute format('select count(*) from %I.%I where %I=any($1)',target.table_schema,target.table_name,target.column_name)
        into remaining using array['${benefits[0]}'::uuid,'${benefits[1]}'::uuid,'${benefits[2]}'::uuid];
    else
      execute format('select count(*) from %I.%I where %I=any($1)',target.table_schema,target.table_name,target.column_name)
        into remaining using array['${campaigns[0]}'::uuid,'${campaigns[1]}'::uuid,'${campaigns[2]}'::uuid];
    end if;
    if remaining<>0 then raise exception 'RAFFLE_FIXTURE_CLEANUP_REMAINS %.%(%): %',target.table_schema,target.table_name,target.column_name,remaining; end if;
  end loop;
  if exists(select 1 from public.app_users where id in ('${owner}','${admin}'))
    or exists(select 1 from public.admin_allowlist where id='${allowlist}')
    or exists(select 1 from public.celebrities where id='${celebrity}')
    or exists(select 1 from public.brands where id='${brand}') then
    raise exception 'RAFFLE_FIXTURE_ROOT_CLEANUP_REMAINS';
  end if;
end $$;`;

try {
  assertEqual("database identity", run("select current_database();"), process.env.PGDATABASE);
  const acl = run(`
    select count(*) from (values
      ('anon','enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz)'),
      ('authenticated','enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz)'),
      ('anon','execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz)'),
      ('authenticated','publish_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz)')
    ) as checks(role_name,signature) where has_function_privilege(role_name,signature,'EXECUTE');
    select count(*) from (values
      ('execute_admin_benefit_draw_unpublished(uuid,uuid,uuid,uuid,uuid,timestamptz)'),
      ('email_notification_delivery_is_eligible_base(uuid,uuid,timestamptz)'),
      ('get_admin_benefit_campaigns_base(uuid,uuid)')
    ) as checks(signature) where has_function_privilege('service_role',signature,'EXECUTE');
  `).split("\n");
  assertEqual("public RPC ACL", acl[0], "0");
  assertEqual("internal base RPC ACL", acl[1], "0");
  run(setup);

  const entryCancel = await Promise.all([
    runSession(`begin; select public.enter_owned_benefit('${owner}','${benefits[0]}','${entryKeys[0]}',2,'2099-01-01T12:00:00Z'); update public.app_users set status='disabled' where id='${owner}'; update public.celebrities set archived_at=pg_catalog.now(),archived_by_admin_allowlist_id='${allowlist}',archive_reason='raffle fixture archive for refund verification' where id='${celebrity}'; select pg_sleep(2); commit;`),
    new Promise((resolve) => setTimeout(() => resolve(runSession(`select public.cancel_admin_benefit_campaign('${admin}','${allowlist}','${id()}','${campaigns[0]}',1,'raffle dev concurrency cancellation','2099-01-01T12:00:01Z');`)), 300)).then((value) => value),
  ]);
  assertSucceeded("entry/cancel serialization", entryCancel);
  assertEqual("entry/cancel refund settlement", run(`select count(*)||':'||coalesce(sum(e.ticket_amount),0) from public.benefit_entry_refunds r join public.benefit_ticket_entries e on e.id=r.entry_id where r.campaign_id='${campaigns[0]}';`), "1:2");
  assertEqual("cancel replay", run(`select (public.cancel_admin_benefit_campaign('${admin}','${allowlist}','${id()}','${campaigns[0]}',2,'raffle dev concurrency cancellation','2099-01-01T12:00:02Z')->>'replayed');`), "true");
  run(`begin; set local session_replication_role=replica; update public.app_users set status='active' where id='${owner}'; update public.celebrities set archived_at=null,archived_by_admin_allowlist_id=null,archive_reason=null where id='${celebrity}'; commit;`);

  const drawKey = id();
  const entryDraw = await Promise.all([
    runSession(`begin; select public.enter_owned_benefit('${owner}','${benefits[1]}','${entryKeys[1]}',3,'2099-01-01T23:59:59Z'); select pg_sleep(2); commit;`),
    new Promise((resolve) => setTimeout(() => resolve(runSession(`select public.execute_admin_benefit_draw('${admin}','${allowlist}','${id()}','${campaigns[1]}','${drawKey}','${publishAt}');`)), 300)).then((value) => value),
  ]);
  assertSucceeded("entry/draw serialization", entryDraw);
  const drawId = run(`select id from public.benefit_draws where campaign_id='${campaigns[1]}';`);
  assertEqual("draw includes committed entry", run(`select count(*)||':'||coalesce(sum(weight),0) from public.benefit_draw_candidates where draw_id='${drawId}';`), "1:3");
  assertEqual("unpublished notification isolation", run(`select count(*) from public.fan_notifications where app_user_id='${owner}' and benefit_id='${benefits[1]}';`), "0");
  assertEqual("unpublished recipient isolation", run(`select count(*) from public.benefit_recipient_private r join public.benefit_draw_winners w on w.id=r.winner_id where w.draw_id='${drawId}';`), "0");

  run(`select public.publish_admin_benefit_draw('${admin}','${allowlist}','${id()}','${campaigns[1]}','${drawId}','${publishAt}'); select public.publish_admin_benefit_draw('${admin}','${allowlist}','${id()}','${campaigns[1]}','${drawId}','${publishAt}');`);
  assertEqual("draw publication exactly once", run(`select count(*) from public.benefit_draw_publications where draw_id='${drawId}';`), "1");
  assertEqual("winner notification exactly once", run(`select count(*) from public.fan_notifications n join public.benefit_draw_winners w on n.source_key='benefit_won:'||w.id::text||':1' where w.draw_id='${drawId}';`), "1");
  assertEqual("delivery queues are future dated", run(`select count(*) from (select available_at from public.notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id where n.app_user_id='${owner}' union all select available_at from public.external_notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id where n.app_user_id='${owner}') q where available_at<'${publishAt}';`), "0");
  assertEqual("no provider/test-sink delivery executed", run(`select count(*) from public.notification_delivery_test_sink s join public.external_notification_delivery_outbox o on o.id=s.delivery_id join public.fan_notifications n on n.id=o.notification_id where n.app_user_id='${owner}';`), "0");

  const fakeNotification = id();
  run(`insert into public.fan_notifications(id,app_user_id,kind,source_key,benefit_id,scheduled_for,deep_link,payload) values('${fakeNotification}','${owner}','benefit_won','benefit_won:${id()}:1','${benefits[1]}','${publishAt}','/benefits/${benefits[1]}','{"title":"fixture","detail":"fixture"}');`);
  assertEqual("send-time draw/source binding", run(`select public.email_notification_delivery_is_eligible('${fakeNotification}','${emailChannel}','${publishAt}');`), "f");

  // Fulfillment notifications use statement time, so remove every delivery destination
  // before exercising the successful recipient and terminal admin workflow.
  run(`update public.push_subscriptions set disabled_at=pg_catalog.now() where app_user_id='${owner}'; update public.fan_notification_channels set status='disabled',consent_revoked_at=pg_catalog.now() where app_user_id='${owner}';`);
  const winnerId = run(`select id from public.benefit_draw_winners where draw_id='${drawId}';`);
  const consentVersion = run("select version from public.benefit_recipient_consent_versions where active and effective_at<=pg_catalog.now() order by effective_at desc,version desc limit 1;");
  if (!consentVersion) throw new Error("active recipient consent fixture dependency missing");
  assertEqual("owner recipient submission", run(`select public.save_owned_benefit_recipient('${owner}','${winnerId}','${id()}','${consentVersion}',true,'Raffle Test','010-0000-0000','00000','Fixture address',null)->>'status';`), "ready");
  assertEqual("fulfillment preparing", run(`select public.transition_admin_benefit_fulfillment('${admin}','${allowlist}','${id()}','${winnerId}',2,'shipping_preparing',null,null,'raffle fixture preparing')->>'status';`), "shipping_preparing");
  assertEqual("fulfillment in transit", run(`select public.transition_admin_benefit_fulfillment('${admin}','${allowlist}','${id()}','${winnerId}',3,'shipping_in_transit','Fixture Carrier','TRACK-${runKey}','raffle fixture in transit')->>'status';`), "shipping_in_transit");
  assertEqual("fulfillment terminal", run(`select public.transition_admin_benefit_fulfillment('${admin}','${allowlist}','${id()}','${winnerId}',4,'shipping_completed',null,null,'raffle fixture completed')->>'status';`), "shipping_completed");
  assertEqual("fulfillment terminal state and history", run(`select f.status||':'||f.revision||':'||count(e.id) from public.benefit_fulfillments f join public.benefit_fulfillment_events e on e.fulfillment_id=f.id where f.winner_id='${winnerId}' group by f.status,f.revision;`), "shipping_completed:5:5");
  assertEqual("disabled destinations block fulfillment delivery queues", run(`select count(*) from (select o.id from public.notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id where n.app_user_id='${owner}' and n.kind='fulfillment_meaningful_update' union all select o.id from public.external_notification_delivery_outbox o join public.fan_notifications n on n.id=o.notification_id where n.app_user_id='${owner}' and n.kind='fulfillment_meaningful_update') q;`), "0");

  const cancelSession = runSession(`begin; select 1 from public.live_benefit_campaigns where id='${campaigns[2]}' for update; select pg_sleep(2); select public.cancel_admin_benefit_campaign('${admin}','${allowlist}','${id()}','${campaigns[2]}',1,'raffle dev cancel wins draw race','${publishAt}'); commit;`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const drawAfterCancel = await runSession(`select public.execute_admin_benefit_draw('${admin}','${allowlist}','${id()}','${campaigns[2]}','${id()}','${publishAt}');`);
  assertSucceeded("cancel side of cancel/draw serialization", [await cancelSession]);
  if (drawAfterCancel.code === 0 || !drawAfterCancel.stderr.includes("PHASE4_BENEFIT_DRAW_CANCELLED")) {
    throw new Error(`cancel/draw serialization: ${drawAfterCancel.stderr || "draw unexpectedly succeeded"}`);
  }

} finally {
  run(cleanup);
  run(verifyCleanup);
}
console.log("PASS: self-contained Dev raffle lifecycle, three 2-session races, publication isolation, send-time binding, future-dated delivery queues, and cleanup zero");
