// Local-only integration server: real CS handlers and authorization guards, synthetic
// Privy verification, and real PostgreSQL storage. No production code imports this file.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
export const actors = {
  fan: { id: "c6000000-0000-4000-8000-000000000001", email: "fan@cs-local.invalid" },
  other: { id: "c6000000-0000-4000-8000-000000000002", email: "other@cs-local.invalid" },
  admin: { id: "c6000000-0000-4000-8000-000000000003", email: "admin@cs-local.invalid", allowlist: "c6100000-0000-4000-8000-000000000001", role: "operator" },
  viewer: { id: "c6000000-0000-4000-8000-000000000004", email: "viewer@cs-local.invalid", allowlist: "c6100000-0000-4000-8000-000000000002", role: "viewer" },
};
const literal = (value) => value === null ? "null" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export function assertLocalDatabase() {
  // The disposable clean-chain harness supplies a private UNIX socket, never a remote host.
  if (process.env.PGPORT !== "55478" || process.env.PGDATABASE !== "byus_clean"
      || !process.env.PGHOST?.includes("/byus-clean-db.") || !process.env.PGHOST.endsWith("/socket")) {
    throw new Error("CS integration requires the disposable local clean-chain database");
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
      if (code !== 0) { reject(new Error(stderr.match(/CS_[A-Z_]+/)?.[0] ?? stderr.trim())); return; }
      try { resolve(stdout.trim() ? JSON.parse(stdout.trim()) : null); } catch { reject(new Error(`Invalid SQL result: ${stdout.slice(0, 80)}`)); }
    });
    child.stdin.end(`set standard_conforming_strings=on; ${service ? "set role service_role;" : ""}\n${sql}\n`);
  });
}
export async function startHarness() {
  assertLocalDatabase();
  for (const [name, actor] of Object.entries(actors)) {
    await query(`insert into public.app_users(id,privy_user_id,verified_email,status) values (${literal(actor.id)},${literal(`did:privy:cs-local-${name}`)},${literal(actor.email)},'active');`, false);
    if (actor.allowlist) await query(`insert into public.admin_allowlist(id,email,role,active) values (${literal(actor.allowlist)},${literal(actor.email)},${literal(actor.role)},true);`, false);
  }
  await query(`insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values (${literal(actors.fan.id)},'별빛팬','별빛팬');`, false);
  const aliases = [
    { find: "@", replacement: web },
    ...["next/link", "next/image", "next/navigation", "@privy-io/react-auth", "server-only"].map((name) => ({
      find: name, replacement: path.join(here, ({ "next/link": "next-link.tsx", "next/image": "next-image.tsx", "next/navigation": "next-navigation.ts", "@privy-io/react-auth": "privy.ts", "server-only": "server-only.ts" })[name]),
    })),
  ];
  let handleApi;
  const vite = await createServer({ plugins: [{ name: "cs-local-api", configureServer(server) { server.middlewares.use((req, res, next) => handleApi ? handleApi(req, res, next) : next()); } }], configFile: false, root: here, publicDir: path.join(web, "public"),
    cacheDir: path.join(web, "node_modules/.vite-cs-local"), resolve: { alias: aliases },
    server: { host: "127.0.0.1", port: 4182, strictPort: true, fs: { allow: [web, path.resolve(web, "../../node_modules")] } },
    ssr: { noExternal: ["server-only"] },
  });
  const { authorizeFanRequest } = await vite.ssrLoadModule(path.join(web, "server/fan-auth/fan-auth-gate.ts"));
  const { authorizeAdminSession } = await vite.ssrLoadModule(path.join(web, "server/admin/admin-session-gate.ts"));
  const { createSupportHandlers, supportFailure, supportJson } = await vite.ssrLoadModule(path.join(web, "server/support/routes.ts"));
  const verifier = { async verify(token) {
    const name = token.startsWith("cs-local-") ? token.slice(9) : "";
    const actor = actors[name];
    if (!actor) throw new Error("Unknown local identity");
    return { privyUserId: `did:privy:cs-local-${name}`, verifiedEmail: actor.email, googleLinked: true };
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
  const dependencies = {
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository }),
    authorizeAdmin: (authorization, correlationId) => authorizeAdminSession({ authorization: authorization ?? "", correlationId, verifier, repository }),
    rpc(name, args) {
      if (!["cs_list", "cs_read", "cs_create", "cs_post", "cs_resolve"].includes(name)) throw new Error("Unknown CS RPC");
      if (Object.keys(args).some((key) => !/^p_[a-z_]+$/.test(key))) throw new Error("Invalid SQL argument");
      return query(`select public.${name}(${Object.entries(args).map(([key, value]) => `${key} => ${literal(value)}`).join(",")});`);
    },
  };
  const handlers = createSupportHandlers(dependencies);
  handleApi = async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    // No LAN binding and no cross-origin requests can access synthetic identities.
    if (req.headers.host !== "127.0.0.1:4182" || (req.headers.origin && req.headers.origin !== "http://127.0.0.1:4182")) { res.statusCode = 403; res.end(); return; }
    const request = new Request(`http://127.0.0.1:4182${req.url}`, { method: req.method, headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method ?? "GET") ? {} : { body: Readable.toWeb(req), duplex: "half" }) });
    let response;
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/session") {
        await dependencies.authorize(request.headers.get("authorization")); response = supportJson({ synchronized: true });
      } else if (url.pathname === "/api/admin/session") {
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), crypto.randomUUID()); response = supportJson({ admin: { email: admin.email, role: admin.role } });
      } else {
        const match = url.pathname.match(/^\/api\/(me|admin)\/inquiries(?:\/([^/]+)(?:\/(messages|resolve))?)?$/);
        if (!match) { response = supportJson({}, 404); }
        else {
          const [, audience, id, action] = match;
          const admin = audience === "admin";
          if (request.method === "GET") response = id ? await handlers.detail(request, id, admin) : await handlers.list(request, admin);
          else if (request.method === "POST" && !id && !admin) response = await handlers.create(request);
          else if (request.method === "POST" && action === "messages") response = await handlers.post(request, id, admin);
          else if (request.method === "POST" && action === "resolve" && admin) response = await handlers.resolve(request, id);
          else response = supportJson({}, 405);
        }
      }
    } catch (error) { response = supportFailure(error); }
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  await vite.listen();
  return { vite, baseURL: "http://127.0.0.1:4182", query, actors, dependencies };
}
