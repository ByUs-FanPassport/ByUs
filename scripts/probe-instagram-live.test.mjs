import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./probe-instagram-live.mjs", import.meta.url));
const fakeToken = "TEST_ONLY_TOKEN_NOT_A_REAL_SECRET_12345";
const identity = { id: "123", user_id: "456", username: "test.owner", account_type: "CREATOR" };
async function run(responses, expected = "offline", mode = 0o600, token = fakeToken) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "byus-ig-probe-"));
  try {
    const credentials = path.join(directory, "credentials.json");
    const preload = path.join(directory, "preload.mjs");
    await writeFile(credentials, JSON.stringify({ accessToken: token, graphVersion: "v25.0" }), { mode });
    await writeFile(preload, `const responses = ${JSON.stringify(responses)};
      globalThis.fetch = async (url, options) => {
        if (url.origin !== 'https://graph.instagram.com' || url.searchParams.has('access_token') || options.redirect !== 'error') throw Error('unsafe request');
        const next = responses.shift(); if (!next) throw Error('unexpected request');
        return new Response(JSON.stringify(next.body), {status: next.status ?? 200});
      };`);
    return spawnSync(process.execPath, ["--import", preload, script, "--credentials", credentials,
      "--username", "test.owner", "--expect", expected], { encoding: "utf8" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("empty successful live_media is offline; upstream errors never become offline", async () => {
  const success = await run([{ body: identity }, { body: { data: [] } }]);
  assert.equal(success.status, 0);
  assert.equal(JSON.parse(success.stdout).state, "offline");
  const failed = await run([{ body: identity }, { status: 400, body: { error: { code: 100, message: fakeToken } } }]);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).state, "unavailable");
  assert.equal(JSON.parse(failed.stdout).code, 100);
  assert.equal((failed.stdout + failed.stderr).includes(fakeToken), false);
});

test("wrong identity stops before live lookup", async () => {
  const result = await run([{ body: { ...identity, username: "other.owner" } }]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).phase, "identity");
});

test("captured practice and public BROADCAST/FEED responses are live without an audience gate", async () => {
  const rows = [
    { id: "18076642742382951", username: "test.owner", media_type: "BROADCAST", media_product_type: "FEED",
      timestamp: "2026-09-12T11:58:27+0000", permalink: "https://www.instagram.com/stories/test.owner/3984540861539244281" },
    { id: "18086854778246758", username: "test.owner", media_type: "BROADCAST", media_product_type: "FEED",
      timestamp: "2026-09-12T12:01:14+0000", permalink: "https://www.instagram.com/stories/test.owner/3984542264785618047" },
  ];
  for (const row of rows) {
    const result = await run([{ body: identity }, { body: { data: [row] } }], "live");
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.state, "live");
    assert.equal(output.media[0].mediaType, "BROADCAST");
    assert.equal(output.media[0].mediaProductType, "FEED");
    assert.equal(output.media[0].actualStartTime, new Date(row.timestamp).toISOString());
  }
});

test("live matching rejects spoof URLs, fallback media URLs, and ordinary VIDEO/FEED media", async () => {
  const row = { id: "18086854778246758", username: "test.owner", media_type: "BROADCAST", media_product_type: "FEED",
    timestamp: "2026-09-12T12:01:14+0000", permalink: "https://www.instagram.com/stories/test.owner/3984542264785618047" };
  for (const override of [
    { permalink: "https://www.instagram.com/stories/other.owner/3984542264785618047" },
    { permalink: "https://www.instagram.com.evil.test/stories/test.owner/3984542264785618047" },
    { permalink: "https://www.instagram.com/p/3984542264785618047/" },
    { permalink: "https://www.instagram.com/reel/3984542264785618047/" },
    { media_type: "VIDEO" },
    { media_product_type: "LIVE" },
  ]) {
    const result = await run([{ body: identity }, { body: { data: [{ ...row, ...override }] } }], "live");
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).state, "unavailable");
  }
});

test("pagination cannot be classified as empty offline", async () => {
  const result = await run([{ body: identity }, { body: { data: [], paging: { next: `https://example.com/?access_token=${fakeToken}` } } }]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).state, "ambiguous");
  assert.equal(result.stdout.includes(fakeToken), false);
});

test("malformed envelopes and paging are unavailable", async () => {
  for (const body of [{}, { data: null }, { data: [], extra: fakeToken }, { data: [], paging: {} },
    { data: [], paging: "next" }, { data: [], paging: { next: 42 } }]) {
    const result = await run([{ body: identity }, { body }]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).state, "unavailable");
    assert.equal(result.stdout.includes(fakeToken), false);
  }
});

test("rejects credential files readable by other users", async () => {
  const result = await run([], "offline", 0o644);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes(fakeToken), false);
});

test("rejects masked UI token before constructing a request", async () => {
  const result = await run([], "offline", 0o600, `IGAA${"•".repeat(40)}`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes("•"), false);
});
