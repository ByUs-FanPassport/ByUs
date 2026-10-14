import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readKyaaAssetBundle } from "./pin-metadata-assets.mjs";

const root = new URL("../apps/worker/assets/kyaa-credentials-v2/", import.meta.url).pathname;

test("the upload sends one shared directory instead of unrelated root files", () => {
  const script = new URL("./pin-metadata-assets.mjs", import.meta.url).pathname;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    process.argv = [process.execPath, ${JSON.stringify(script)}, 'prod', 'kyaa-v2'];
    process.env.PINATA_PROD_JWT = 'test-only';
    globalThis.fetch = async (_url, request) => {
      const files = request.body.getAll('file');
      assert.equal(files.length, 16);
      assert(files.every(file => file.name.startsWith('credentials/v2/')), 'one common directory is required');
      return new Response(JSON.stringify({IpfsHash:'bafy-test'}));
    };
    await import(${JSON.stringify(script)});
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(JSON.parse(output).fileCount, 16);
});

test("the complete kyaa bundle contains 15 checked transparent PNGs and its manifest", async () => {
  const files = await readKyaaAssetBundle(root);
  assert.equal(files.length, 16);
  assert.equal(files.filter((file) => file.name.endsWith(".png")).length, 15);
  assert(files.some((file) => file.name === "mission.png"));
});

test("publication refuses missing types and paths outside the approved bundle", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "kyaa-assets-test-"));
  try {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    await writeFile(join(temporary, "manifest.json"), JSON.stringify({ ...manifest, assets: manifest.assets.slice(1) }));
    await assert.rejects(readKyaaAssetBundle(temporary), /incomplete|coverage/i);
    manifest.assets[0].file = "../private.png";
    await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(readKyaaAssetBundle(temporary), /path/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("publication refuses a file whose bytes no longer match the reviewed manifest", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "kyaa-assets-test-"));
  try {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest));
    await Promise.all(manifest.assets.map((asset) => writeFile(join(temporary, asset.file), "changed")));
    await assert.rejects(readKyaaAssetBundle(temporary), /integrity/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
