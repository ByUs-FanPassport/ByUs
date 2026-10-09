import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mergeAttributes } from "@tiptap/core";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));

test("Axios ignores inherited HTTP methods when making a default GET request", async () => {
  const axios = createRequire(new URL("node_modules/@coinbase/cdp-sdk/package.json", root))("axios");
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "method");
  Object.defineProperty(Object.prototype, "method", { value: "delete", configurable: true, writable: true });
  try {
    const response = await axios({
      url: "https://example.invalid",
      adapter: async (config) => ({ data: config.method, status: 200, statusText: "OK", headers: {}, config }),
    });
    assert.equal(response.data, "get");
  } finally {
    if (original) Object.defineProperty(Object.prototype, "method", original);
    else delete Object.prototype.method;
  }
});

test("Tiptap keeps __proto__ inert without inheriting executable attributes", () => {
  const merged = mergeAttributes({ class: "notice" }, JSON.parse('{"__proto__":{"onload":"alert(1)"},"title":"safe"}'));
  assert.equal(merged.onload, undefined);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(merged.class, "notice");
  assert.equal(merged.title, "safe");
});

// Exercise every installed nested copy: the vulnerable path was inside Wagmi/Reown,
// not the newer top-level WalletConnect copy used by Privy.
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path.endsWith("/node_modules/@walletconnect/utils") && path !== "node_modules/@walletconnect/utils") continue;
  test(`WalletConnect ${metadata.version} URI round trip (${path})`, () => {
    const require = createRequire(new URL(`${path}/package.json`, root));
    const { formatUri, parseUri } = require(".");
    const params = { protocol: "wc", topic: "a".repeat(64), version: 2, symKey: "b".repeat(64), relay: { protocol: "irn" } };
    const parsed = parseUri(formatUri(params));
    for (const key of ["topic", "version", "symKey", "relay"]) assert.deepEqual(parsed[key], params[key]);
    assert.equal(parseUri(`${formatUri(params)}&unknown=%E0%A4%A`).topic, params.topic);
  });
}

test("Next ESLint root-directory discovery keeps literal, wildcard, brace, and absolute paths without braces", async () => {
  const require = createRequire(new URL("node_modules/@next/eslint-plugin-next/package.json", root));
  const { getRootDirs } = require("./dist/utils/get-root-dirs.js");
  const { globSync } = require("fast-glob");
  assert.deepEqual(Object.entries(lock.packages).filter(([, entry]) => entry.dependencies?.["fast-glob"]).map(([name]) => name), ["node_modules/@next/eslint-plugin-next"]);
  const directory = await mkdtemp(path.join(tmpdir(), "byus-eslint-glob-"));
  const cwd = process.cwd();
  try {
    await mkdir(path.join(directory, "apps/web/nested"), { recursive: true });
    await mkdir(path.join(directory, "apps/worker"), { recursive: true });
    process.chdir(directory);
    assert.deepEqual(globSync("apps/web", { onlyDirectories: true }), ["apps/web"]);
    assert.deepEqual(globSync("apps/*", { onlyDirectories: true }).sort(), ["apps/web", "apps/worker"]);
    assert.deepEqual(globSync("apps/{web,worker}", { onlyDirectories: true }).sort(), ["apps/web", "apps/worker"]);
    assert.deepEqual(getRootDirs({ cwd: directory, settings: {} }), [directory]);
    assert.deepEqual(getRootDirs({ cwd: directory, settings: { next: { rootDir: [path.join(directory, "apps/web"), "apps/worker"] } } }), [path.join(directory, "apps/web"), "apps/worker"]);
    assert.deepEqual(globSync("missing/*", { onlyDirectories: true }), []);
    assert(!Object.keys(lock.packages).some(name => name.endsWith("node_modules/braces")));
  } finally { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); }
});
