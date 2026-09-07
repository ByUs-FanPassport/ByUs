import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createInstagramTestGateway } from "./instagram-oauth-test-gateway.mjs";

let upstream, gateway, base;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
before(async () => {
  upstream = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization ?? null, host: req.headers.host })); });
  const port = await listen(upstream);
  gateway = createInstagramTestGateway({ upstreamPort: port, publicOrigin: "https://byus-test.invalid" });
  base = `http://127.0.0.1:${await listen(gateway)}`;
});
after(async () => { await Promise.all([upstream, gateway].map((server) => new Promise((resolve) => server.close(resolve)))); });
test("only the six OAuth and signed-callback paths are forwarded", async () => {
  const result = await fetch(`${base}/connect/instagram/callback?code=fixture&state=fixture`, { headers: { authorization: "Bearer must-not-forward" } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { path: "/connect/instagram/callback?code=fixture&state=fixture", authorization: null, host: "byus-test.invalid" });
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
});
test("blocks admin, internal cron, database, debug and source routes", async () => {
  for (const path of ["/admin", "/api/admin/instagram/invites", "/api/internal/instagram/sync", "/rest/v1/instagram_connections", "/_next/static/test.js", "/.env", "/connect/instagram/../../api/admin/session"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
test("blocks unsupported methods and oversized signed forms", async () => {
  assert.equal((await fetch(`${base}/connect/instagram/callback`, { method: "POST", body: "code=fixture" })).status, 404);
  assert.equal((await fetch(`${base}/api/instagram/data-deletion`, { method: "POST", body: "x".repeat(16385) })).status, 413);
});
