import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("./prepare-live-preview.mjs", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260726030000_live_event_previews.sql",
    import.meta.url,
  ),
  "utf8",
);

test("media command creates only the approved silent H.264 and WebP derivatives", () => {
  for (const contract of [
    'renderDerivative\\(options, "square"',
    'renderDerivative\\(options, "landscape"',
    "`\\$\\{ratio\\}\\.mp4`",
    "`\\$\\{ratio\\}-poster\\.webp`",
    '"-an"',
    '"libx264"',
    '"+faststart"',
    '"cwebp"',
    "720",
    "1280",
    "640",
  ]) {
    assert.match(script, new RegExp(contract.replace(/[+]/g, "\\+")));
  }
  assert.doesNotMatch(script, /upload\(options\.input/);
});

test("database publication is rights-gated and verifies all Storage derivatives", () => {
  assert.match(migration, /rights_holder text not null/);
  assert.match(migration, /rights_basis text not null/);
  assert.match(migration, /source_reference text not null/);
  assert.match(migration, /storage\.objects/);
  assert.match(migration, /missing_objects <> 0/);
  assert.match(migration, /publication_status = 'published'/);
  assert.match(migration, /preview\.publication_status = 'published'/);
});

test("content-addressed paths are rooted under the LIVE id and source SHA", () => {
  assert.match(
    script,
    /live-previews\/\$\{options\.liveEventId\}\/\$\{sourceSha\}/,
  );
  assert.match(
    migration,
    /'live-previews\/' \|\| p_live_event_id::text \|\| '\/' \|\| p_source_sha256/,
  );
});
