import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mergeAttributes } from "@tiptap/core";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));

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
