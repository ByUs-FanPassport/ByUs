import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));
function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), "byus-ignore-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "build-test@example.invalid");
  git("config", "user.name", "Build test");
  const write = (path, content = "changed") => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), content); };
  const commit = () => { git("add", "."); git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"); return git("rev-parse", "HEAD"); };
  write("apps/web/page.tsx", "original");
  const base = commit();
  const run = (previous = base, current = git("rev-parse", "HEAD")) => spawnSync(process.execPath, [script], { cwd, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current } }).status;
  return { cwd, git, write, commit, base, run };
}
for (const [path, expected] of [["docs/readme.md", 0], ["apps/worker/src/job.ts", 0], ["apps/worker/package.json", 1], ["apps/web/page.tsx", 1], ["package-lock.json", 1], ["scripts/build.mjs", 1], ["unknown/file.txt", 1]]) {
  test(`change ${path}: exit ${expected}`, (t) => {
    const r = repo(t); r.write(path); r.commit(); assert.equal(r.run(), expected);
  });
}
test("mixed web and docs changes build", (t) => {
  const r = repo(t); r.write("docs/readme.md"); r.write("apps/web/page.tsx"); r.commit(); assert.equal(r.run(), 1);
});
test("web rename into docs still builds", (t) => {
  const r = repo(t); mkdirSync(join(r.cwd, "docs")); renameSync(join(r.cwd, "apps/web/page.tsx"), join(r.cwd, "docs/page.tsx")); r.commit(); assert.equal(r.run(), 1);
});
test("failed web deployment followed by docs still builds from successful base", (t) => {
  const r = repo(t); r.write("apps/web/page.tsx"); r.commit(); r.write("docs/readme.md"); r.commit(); assert.equal(r.run(), 1);
});
test("missing, invalid, unavailable, same and mismatched SHAs build", (t) => {
  const r = repo(t); r.write("docs/readme.md"); const current = r.commit();
  for (const previous of ["", "HEAD^", "f".repeat(40), current]) assert.equal(r.run(previous), 1);
  assert.equal(r.run(r.base, r.base), 1);
  assert.equal(r.run(r.base, ""), 1);
});
test("diverged deployment history builds", (t) => {
  const r = repo(t); r.write("docs/other.md"); const other = r.commit(); r.git("checkout", "-b", "diverged", r.base); r.write("docs/this.md"); r.commit(); assert.equal(r.run(other), 1);
});
