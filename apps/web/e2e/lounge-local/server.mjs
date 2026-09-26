// Local-only integration server: real Lounge handlers and authorization guards, synthetic
// Privy verification, and real PostgreSQL storage. No production code imports this file.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
export const actors = {
  fan: { id: "c7000000-0000-4000-8000-000000000001", email: "fan@lounge-local.invalid" },
  other: { id: "c7000000-0000-4000-8000-000000000002", email: "other@lounge-local.invalid" },
  admin: { id: "c7000000-0000-4000-8000-000000000003", email: "admin@lounge-local.invalid", allowlist: "c7100000-0000-4000-8000-000000000001", role: "operator" },
  viewer: { id: "c7000000-0000-4000-8000-000000000004", email: "viewer@lounge-local.invalid", allowlist: "c7100000-0000-4000-8000-000000000002", role: "viewer" },
};
const literal = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? `array[${value.map(literal).join(",")}]::uuid[]` : "'{}'::uuid[]";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'${typeof value === "object" ? "::jsonb" : ""}`;
};
export function assertLocalDatabase() {
  // The disposable clean-chain harness supplies a private UNIX socket, never a remote host.
  if (process.env.PGPORT !== "55479" || process.env.PGDATABASE !== "byus_clean"
      || !process.env.PGHOST?.includes("/byus-clean-db.") || !process.env.PGHOST.endsWith("/socket")) {
    throw new Error("Lounge integration requires the disposable local clean-chain database");
  }
}
export function query(sql, service = true) {
  assertLocalDatabase();
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(stderr.match(/(?:FANPAGE|FAN_WEB|TRANSLATION)_[A-Z_]+/)?.[0] ?? stderr.trim())); return; }
      try { resolve(stdout.trim() ? JSON.parse(stdout.trim()) : null); } catch { reject(new Error(`Invalid SQL result: ${stdout.slice(0, 80)}`)); }
    });
    child.stdin.end(`set standard_conforming_strings=on; ${service ? "set role service_role;" : ""}\n${sql}\n`);
  });
}
export async function startHarness({ communityMode = false, fanWebMode = false } = {}) {
  assertLocalDatabase();
  for (const [name, actor] of Object.entries(actors)) {
    await query(`insert into public.app_users(id,privy_user_id,verified_email,status) values (${literal(actor.id)},${literal(`did:privy:lounge-local-${name}`)},${literal(actor.email)},'active');`, false);
    if (actor.allowlist) await query(`insert into public.admin_allowlist(id,email,role,active) values (${literal(actor.allowlist)},${literal(actor.email)},${literal(actor.role)},true);`, false);
  }
  await query(`insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values (${literal(actors.fan.id)},'별빛팬','별빛팬');`, false);

  await query(`insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values (${literal(actors.other.id)},'바다소리','바다소리');`, false);
  await query(`insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id) values (${literal(actors.fan.id)},'star-pink','star-pink'),(${literal(actors.other.id)},'heart-lavender','heart-lavender') on conflict(app_user_id) do update set selected_character_id=excluded.selected_character_id;`, false);
  await query(`begin; insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values ('c7200000-0000-4000-8000-000000000001','elina','published','/images/guest-home/elina-card.jpg',now(),'{creator,artist}','creator');
    insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values ('c7200000-0000-4000-8000-000000000001','ko','엘리나','엘리나 팬페이지','엘리나'),('c7200000-0000-4000-8000-000000000001','en','Elina','Elina fan page','Elina');
    insert into public.celebrity_notices(id,celebrity_id,slug,publication_status,published_at,ever_published_at) values ('c7300000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001','welcome-byus','published',now(),now());
    insert into public.celebrity_notice_localizations(notice_id,locale,title,body_json) values ('c7300000-0000-4000-8000-000000000001','ko','환영합니다','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"반가워요"}]}]}'::jsonb),('c7300000-0000-4000-8000-000000000001','en','Welcome','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Welcome"}]}]}'::jsonb); commit;`, false);
  if (fanWebMode) {
    await query(`begin;
      insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
        ('${actors.fan.id}',91342,'0x'||repeat('a',40),'privy','embedded'),
        ('${actors.other.id}',91342,'0x'||repeat('b',40),'privy','embedded');
      insert into public.celebrity_quizzes(id,celebrity_id,version,status) values ('c7600000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001',1,'draft');
      insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
        ('c7610000-0000-4000-8000-000000000001','${actors.fan.id}','c7200000-0000-4000-8000-000000000001','c7600000-0000-4000-8000-000000000001',1,'c7610000-0000-4000-8000-000000000001','passed',3,now()),
        ('c7610000-0000-4000-8000-000000000002','${actors.other.id}','c7200000-0000-4000-8000-000000000001','c7600000-0000-4000-8000-000000000001',1,'c7610000-0000-4000-8000-000000000002','passed',3,now());
      insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
        ('c7630000-0000-4000-8000-000000000001','${actors.fan.id}','c7200000-0000-4000-8000-000000000001','c7610000-0000-4000-8000-000000000001'),
        ('c7630000-0000-4000-8000-000000000002','${actors.other.id}','c7200000-0000-4000-8000-000000000001','c7610000-0000-4000-8000-000000000002');
      insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values
        ('c7400000-0000-4000-8000-000000000001','passport','c7640000-0000-4000-8000-000000000001','byus:passport:v1:${actors.fan.id}:elina',1,jsonb_build_object('recipient','0x'||repeat('a',40),'celebritySlug','elina','passportId','0x'||repeat('a',64))),
        ('c7400000-0000-4000-8000-000000000002','passport','c7640000-0000-4000-8000-000000000002','byus:passport:v1:${actors.other.id}:elina',1,jsonb_build_object('recipient','0x'||repeat('b',40),'celebritySlug','elina','passportId','0x'||repeat('b',64)));
      insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id) values
        ('c7640000-0000-4000-8000-000000000001','${actors.fan.id}','c7200000-0000-4000-8000-000000000001','c7630000-0000-4000-8000-000000000001','c7400000-0000-4000-8000-000000000001'),
        ('c7640000-0000-4000-8000-000000000002','${actors.other.id}','c7200000-0000-4000-8000-000000000001','c7630000-0000-4000-8000-000000000002','c7400000-0000-4000-8000-000000000002');
      insert into public.celebrity_schedules(id,celebrity_id,kind,title_ko,title_en,description_ko,description_en,starts_at,ends_at,time_zone,location,participation_instructions,official_source_url,status,idempotency_key,request_hash)
        values('c7800000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001','broadcast','엘리나 라이브','Elina Live','팬과 만나는 라이브','Live with fans',now()+interval '7 days',now()+interval '8 days','Asia/Seoul','온라인','방송 링크에서 참여하세요','https://example.com/elina-live','published','c7810000-0000-4000-8000-000000000001',repeat('a',64));
      commit;`, false);
  }
  if (communityMode) {
    await query(`begin;
      insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values ('${actors.viewer.id}','달빛길','달빛길');
      insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id) values ('${actors.viewer.id}','fairy-cream','fairy-cream');
      insert into public.fan_activity_visibility(app_user_id,enabled) values ('${actors.fan.id}',true),('${actors.other.id}',false),('${actors.viewer.id}',true);
      alter table public.fan_reactions disable trigger user;
      insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload) values
        ('c7400000-0000-4000-8000-000000000001','reaction','c7410000-0000-4000-8000-000000000001','community-local-like-fan','{}'),
        ('c7400000-0000-4000-8000-000000000002','reaction','c7410000-0000-4000-8000-000000000002','community-local-like-other','{}');
      insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,mint_status,completed_at) values
        ('c7410000-0000-4000-8000-000000000001','${actors.fan.id}','c7200000-0000-4000-8000-000000000001','c7400000-0000-4000-8000-000000000001','queued',now()-interval '1 second'),
        ('c7410000-0000-4000-8000-000000000002','${actors.other.id}','c7200000-0000-4000-8000-000000000001','c7400000-0000-4000-8000-000000000002','permanent_failure',now()-interval '2 seconds');
      alter table public.fan_reactions enable trigger user;
      insert into public.celebrity_quizzes(id,celebrity_id,version,status) values ('c7600000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001',1,'draft');
      insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values ('c7610000-0000-4000-8000-000000000001','${actors.viewer.id}','c7200000-0000-4000-8000-000000000001','c7600000-0000-4000-8000-000000000001',1,'c7620000-0000-4000-8000-000000000001','passed',3,now());
      insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values ('c7630000-0000-4000-8000-000000000001','${actors.viewer.id}','c7200000-0000-4000-8000-000000000001','c7610000-0000-4000-8000-000000000001');
      insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,issued_at) values ('c7640000-0000-4000-8000-000000000001','${actors.viewer.id}','c7200000-0000-4000-8000-000000000001','c7630000-0000-4000-8000-000000000001',now());
      insert into public.fan_lounge_messages(id,celebrity_id,app_user_id,body,idempotency_key,created_at) values
        ('c7500000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001','${actors.other.id}','먼저 남겨둔 응원','c7510000-0000-4000-8000-000000000001',now()-interval '2 minutes');
      insert into public.fan_lounge_messages(id,celebrity_id,app_user_id,body,idempotency_key,reply_to_id,created_at) values
        ('c7500000-0000-4000-8000-000000000002','c7200000-0000-4000-8000-000000000001','${actors.fan.id}','공개되면 안 되는 이전 답글','c7510000-0000-4000-8000-000000000002','c7500000-0000-4000-8000-000000000001',now()-interval '1 minute');
      commit;`, false);
  }
  const aliases = [
    { find: "@", replacement: web },
    ...["next/link", "next/image", "next/navigation", "@privy-io/react-auth", "server-only"].map((name) => ({
      find: name, replacement: path.join(here, ({ "next/link": "next-link.tsx", "next/image": "next-image.tsx", "next/navigation": "next-navigation.ts", "@privy-io/react-auth": "privy.ts", "server-only": "server-only.ts" })[name]),
    })),
  ];
  let handleApi;
  const vite = await createServer({ plugins: [{ name: "lounge-local-api", configureServer(server) { server.middlewares.use((req, res, next) => handleApi ? handleApi(req, res, next) : next()); } }], configFile: false, root: here, publicDir: path.join(web, "public"),
    define: { "import.meta.env.VITE_COMMUNITY_MODE": JSON.stringify(String(communityMode)), "import.meta.env.VITE_FAN_WEB_MODE": JSON.stringify(String(fanWebMode)) },
    cacheDir: path.join(web, "node_modules/.vite-lounge-local"), resolve: { alias: aliases },
    server: { host: "127.0.0.1", port: 4184, strictPort: true, fs: { allow: [web, path.resolve(web, "../../node_modules")] } },
    ssr: { noExternal: ["server-only"] },
  });
  const { authorizeFanRequest } = await vite.ssrLoadModule(path.join(web, "server/fan-auth/fan-auth-gate.ts"));
  const { authorizeAdminSession } = await vite.ssrLoadModule(path.join(web, "server/admin/admin-session-gate.ts"));
  const { createLoungeHandlers } = await vite.ssrLoadModule(path.join(web, "server/lounge/routes.ts"));
  const { createFanCommunityHandlers } = await vite.ssrLoadModule(path.join(web, "server/fanpage/community-routes.ts"));
  const { fanpageFailure, fanpageJson, createFanpageHandlers } = await vite.ssrLoadModule(path.join(web, "server/fanpage/routes.ts"));
  const { createContentHandlers } = await vite.ssrLoadModule(path.join(web, "server/fan-posts/routes.ts"));
  const { normalizePublicImage } = await vite.ssrLoadModule(path.join(web, "server/media/public-image-processing.ts"));
  const { createParticipationHandler } = await vite.ssrLoadModule(path.join(web, "server/schedules/routes.ts"));
  const { createFanHistoryHandler } = await vite.ssrLoadModule(path.join(web, "server/my/fan-history-route.ts"));
  const { createOfficialMediaHandler } = await vite.ssrLoadModule(path.join(web, "server/media/official-media-route.ts"));
  const verifier = { async verify(token) {
    const name = token.startsWith("lounge-local-") ? token.slice(13) : "";
    const actor = actors[name];
    if (!actor) throw new Error("Unknown local identity");
    return { privyUserId: `did:privy:lounge-local-${name}`, verifiedEmail: actor.email, googleLinked: true };
  } };
  const repository = {
    async findUserByPrivyId(privyUserId) {
      return query(`select jsonb_build_object('id',id,'privyUserId',privy_user_id,'verifiedEmail',verified_email,'status',status) from public.app_users where privy_user_id=${literal(privyUserId)};`);
    },
    async findActiveAdminByEmail(email) {
      return query(`select jsonb_build_object('id',id,'email',email,'role',role,'active',active) from public.admin_allowlist where email=${literal(email)} and active;`);
    },
    async appendAuthorizationAudit(event) {
      await query(`insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,correlation_id,before_after_summary) values(${literal(event.actorAppUserId)},${literal(event.actorAdminAllowlistId)},${literal(event.action)},'admin_session',${literal(event.correlationId)},${literal(JSON.stringify(event.summary))}::jsonb);`);
    },
  };
  const allowedRpc = new Set([
    "read_celebrity_lounge", "post_celebrity_lounge_message", "remove_owned_lounge_message", "set_lounge_message_reaction", "read_admin_lounge_messages", "hide_admin_lounge_message",
    "read_celebrity_notice_comments", "post_celebrity_notice_comment", "remove_owned_notice_comment", "read_celebrity_fan_community", "read_celebrity_fan_leaderboard", "read_celebrity_cheers", "post_celebrity_cheer",
    "read_fan_notices", "read_fan_notice", "read_fan_posts", "save_fan_post", "read_fan_post", "remove_fan_post", "read_fan_post_comments", "post_fan_post_comment", "remove_fan_post_comment", "set_fan_post_like",
    "reserve_content_asset", "finish_content_asset_upload", "abandon_content_asset_upload", "read_content_asset", "read_admin_content_asset", "post_content_report", "block_content_author", "read_content_blocks", "remove_content_block",
    "read_content_translation", "fan_web_content_target", "reserve_content_translation_request", "save_content_translation", "read_admin_content_reports", "resolve_admin_content_report",
    "fan_web_list_schedules", "fan_web_get_schedule", "fan_web_set_schedule_subscription", "fan_web_list_owned_schedule_suggestions", "fan_web_submit_schedule_suggestion",
    "fan_web_list_owned_fanpage_requests", "fan_web_submit_fanpage_request", "fan_web_check_fanpage_request", "fan_web_list_live_submissions", "fan_web_submit_live_submission", "fan_web_delete_live_submission",
    "fan_web_admin_list_schedules", "fan_web_admin_save_schedule", "fan_web_admin_list_schedule_suggestions", "fan_web_admin_review_schedule_suggestion", "fan_web_admin_list_fanpage_requests", "fan_web_admin_review_fanpage_request",
    "fan_web_admin_list_live_submissions", "fan_web_admin_save_live_submission_settings", "fan_web_admin_review_live_submission", "fan_web_admin_get_live_replay", "fan_web_admin_save_live_replay", "get_owned_fan_history",
  ]);
  const localAssets = new Map();
  const dependencies = {
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository }),
    authorizeAdmin: (authorization, correlationId) => authorizeAdminSession({ authorization: authorization ?? "", correlationId, verifier, repository }),
    rpc(name, args) {
      if (!allowedRpc.has(name)) throw new Error("Unknown local RPC");
      if (Object.keys(args).some((key) => !/^p_[a-z0-9_]+$/.test(key))) throw new Error("Invalid SQL argument");
      return query(`select public.${name}(${Object.entries(args).map(([key, value]) => `${key} => ${literal(value)}`).join(",")});`);
    },
  };
  const handlers = createLoungeHandlers(dependencies);
  const fanpage = createFanpageHandlers(dependencies);
  const community = createFanCommunityHandlers(dependencies);
  const content = createContentHandlers({ ...dependencies,
    async upload(owner, slug, bytes) {
      const image = await normalizePublicImage(bytes);
      const reserved = await dependencies.rpc("reserve_content_asset", { p_app_user_id: owner, p_slug: slug, p_byte_size: image.bytes.byteLength, p_width: image.width, p_height: image.height, p_sha256: image.sha256 });
      localAssets.set(reserved.storagePath, new Blob([image.bytes], { type: "image/webp" }));
      try { await dependencies.rpc("finish_content_asset_upload", { p_app_user_id: owner, p_asset_id: reserved.id }); }
      catch (error) { localAssets.delete(reserved.storagePath); await dependencies.rpc("abandon_content_asset_upload", { p_app_user_id: owner, p_asset_id: reserved.id }); throw error; }
      return { id: reserved.id, width: image.width, height: image.height };
    },
    async download(storagePath) { const value = localAssets.get(storagePath); if (!value) throw new Error("FAN_WEB_NOT_FOUND"); return value; },
    async translate() { throw new Error("TRANSLATION_UNAVAILABLE"); },
  });
  const participation = createParticipationHandler(dependencies);
  const history = createFanHistoryHandler(dependencies);
  const officialMedia = createOfficialMediaHandler(dependencies);
  handleApi = async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    // No LAN binding and no cross-origin requests can access synthetic identities.
    if (req.headers.host !== "127.0.0.1:4184" || (req.headers.origin && req.headers.origin !== "http://127.0.0.1:4184")) { res.statusCode = 403; res.end(); return; }
    const request = new Request(`http://127.0.0.1:4184${req.url}`, { method: req.method, headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method ?? "GET") ? {} : { body: Readable.toWeb(req), duplex: "half" }) });
    let response;
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/session") {
        await dependencies.authorize(request.headers.get("authorization")); response = fanpageJson({ synchronized: true });
      } else if (url.pathname === "/api/admin/session") {
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), crypto.randomUUID()); response = fanpageJson({ admin: { email: admin.email, role: admin.role } });
      } else {
        const room = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/lounge$/);
        const message = url.pathname.match(/^\/api\/lounge-messages\/([^/]+)(\/reactions)?$/);
        const fans = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/fans$/);
        const cheers = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/cheers$/);
        const cheer = url.pathname.match(/^\/api\/cheers\/([^/]+)$/);
        const admin = url.pathname.match(/^\/api\/admin\/lounge-messages(?:\/([^/]+))?$/);
        const comments = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/notices\/([^/]+)\/comments$/);
        const notice = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/notices\/([^/]+)$/);
        const posts = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/posts$/);
        const media = url.pathname.match(/^\/api\/celebrities\/([^/]+)\/media$/);
        const post = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
        const postComments = url.pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
        const postLike = url.pathname.match(/^\/api\/posts\/([^/]+)\/like$/);
        const postComment = url.pathname.match(/^\/api\/post-comments\/([^/]+)$/);
        const asset = url.pathname.match(/^\/api\/content-assets\/([^/]+)$/);
        const block = url.pathname.match(/^\/api\/content-blocks\/([^/]+)$/);
        const report = url.pathname.match(/^\/api\/admin\/content-reports\/([^/]+)$/);
        const schedule = url.pathname.match(/^\/api\/schedules\/([^/]+)$/);
        const subscription = url.pathname.match(/^\/api\/schedules\/([^/]+)\/subscription$/);
        const adminSuggestion = url.pathname.match(/^\/api\/admin\/schedule-suggestions\/([^/]+)$/);
        const adminRequest = url.pathname.match(/^\/api\/admin\/fanpage-requests\/([^/]+)$/);
        if (communityMode && (room || message)) response = fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        else if (room) response = request.method === "GET" ? await handlers.read(request, room[1]) : await handlers.post(request, room[1]);
        else if (message) response = message[2] ? await handlers.react(request, message[1]) : await handlers.remove(request, message[1]);
        else if (fans) response = await community.fans(request, fans[1]);
        else if (cheers) response = request.method === "GET" ? await community.cheers(request, cheers[1]) : await community.postCheer(request, cheers[1]);
        else if (cheer) response = await community.removeCheer(request, cheer[1]);
        else if (admin) response = admin[1] ? await handlers.adminHide(request, admin[1]) : await handlers.adminList(request);
        else if (comments) response = request.method === "GET" ? await fanpage.comments(request, comments[1], comments[2]) : await fanpage.postComment(request, comments[1], comments[2]);
        else if (fanWebMode && notice) response = await content.notice(request, notice[1], notice[2]);
        else if (fanWebMode && media) response = await officialMedia(request, media[1]);
        else if (fanWebMode && posts) response = await content.posts(request, posts[1]);
        else if (fanWebMode && postComments) response = await content.comments(request, postComments[1]);
        else if (fanWebMode && postLike) response = await content.like(request, postLike[1]);
        else if (fanWebMode && post) response = await content.post(request, post[1]);
        else if (fanWebMode && postComment) response = await content.removeComment(request, postComment[1]);
        else if (fanWebMode && url.pathname === "/api/content-assets") response = await content.upload(request);
        else if (fanWebMode && asset) response = await content.asset(request, asset[1]);
        else if (fanWebMode && url.pathname === "/api/content-blocks") response = await content.blocks(request);
        else if (fanWebMode && block) response = await content.unblock(request, block[1]);
        else if (fanWebMode && url.pathname === "/api/content-reports") response = await content.report(request);
        else if (fanWebMode && url.pathname === "/api/content-translations") response = await content.translate(request);
        else if (fanWebMode && url.pathname === "/api/admin/content-reports") response = await content.adminReports(request);
        else if (fanWebMode && report) response = await content.resolveReport(request, report[1]);
        else if (fanWebMode && url.pathname === "/api/schedules") response = await participation("schedules", request);
        else if (fanWebMode && subscription) response = await participation("subscription", request, { id: subscription[1] });
        else if (fanWebMode && schedule) response = await participation("schedule", request, { id: schedule[1] });
        else if (fanWebMode && url.pathname === "/api/schedule-suggestions") response = await participation("suggestions", request);
        else if (fanWebMode && url.pathname === "/api/fanpage-requests/check") response = await participation("request-check", request);
        else if (fanWebMode && url.pathname === "/api/fanpage-requests") response = await participation("requests", request);
        else if (fanWebMode && url.pathname === "/api/admin/schedules") response = await participation("admin-schedules", request);
        else if (fanWebMode && url.pathname === "/api/admin/schedule-suggestions") response = await participation("admin-suggestions", request);
        else if (fanWebMode && adminSuggestion) response = await participation("admin-suggestion", request, { id: adminSuggestion[1] });
        else if (fanWebMode && url.pathname === "/api/admin/fanpage-requests") response = await participation("admin-requests", request);
        else if (fanWebMode && adminRequest) response = await participation("admin-request", request, { id: adminRequest[1] });
        else if (fanWebMode && url.pathname === "/api/me/activity") response = await history(request);
        else if (fanWebMode && url.pathname === "/api/admin/lives") response = fanpageJson({ celebrities: [await query(`select jsonb_build_object('id',id,'slug',slug,'status',status,'nameKo',(select name from public.celebrity_localizations where celebrity_id=celebrities.id and locale='ko'),'nameEn',(select name from public.celebrity_localizations where celebrity_id=celebrities.id and locale='en')) from public.celebrities where slug='elina';`)] });
        else if (url.pathname.endsWith("/notices")) response = fanWebMode ? await content.notices(request, url.pathname.split("/")[3]) : fanpageJson({ notices: [{ slug: "welcome-byus", title: "엘리나 팬페이지에 오신 걸 환영해요", pinned: true, kind: "welcome", publishedAt: "2026-09-11T13:31:22Z" }] });
        else if (url.pathname === "/api/me/summary") response = fanpageJson({ summary: { profile: { nickname: "별빛팬" }, creators: [], live: { upcoming: [], history: [] }, rewards: { availableCount: 0, entries: 0, items: [] }, collection: { passportCount: 0, stampCount: 0, collectibleCount: 0, recent: [] }, unreadNotificationCount: 0 } });
        else if (url.pathname === "/api/me/avatar") response = fanpageJson({ avatar: { initialCharacterId: "star-pink", characterId: "star-pink", source: "character", hasImage: false, revision: 0 } });
        else if (url.pathname.endsWith("/leaderboard")) response = await fanpage.leaderboard(request, url.pathname.split("/")[3]);
        else if (url.pathname.endsWith("/fanpage")) response = fanpageJson({ membershipCount: 0, leaderboardAvailable: false, activity: [] });
        else if (url.pathname.endsWith("/fan-activity-visibility")) response = fanpageJson({ error: { code: "FAN_ACTIVITY_VISIBILITY_RETIRED" } },410);
        else if (url.pathname.endsWith("/reactions")) response = fanpageJson({ reaction: null });
        else if (url.pathname.endsWith("/raffles")) response = fanpageJson({ raffles: [] });
        else if (url.pathname.endsWith("/calendar")) { const month = url.searchParams.get("month"); response = fanpageJson({ month, timeZone: "Asia/Seoul", days: Array.from({ length: new Date(Number(month.slice(0,4)), Number(month.slice(5)), 0).getDate() }, (_, i) => ({ date: `${month}-${String(i+1).padStart(2,"0")}`, events: [] })) }); }
        else response = fanWebMode ? fanpageJson({ error: { code: "LOCAL_ROUTE_NOT_FOUND" } }, 404) : fanpageJson({});
      }
    } catch (error) { response = fanpageFailure(error); }
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  await vite.listen();
  return { vite, baseURL: "http://127.0.0.1:4184", query, actors, dependencies, communityMode, fanWebMode };
}
