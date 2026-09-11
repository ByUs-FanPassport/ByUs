import { execFileSync } from "node:child_process";

// Vercel: exit 0 skips, exit 1 builds. Compare against the last SUCCESSFUL
// deployment, not HEAD^, so a failed web change followed by docs still builds.
function canSkip() {
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  const current = process.env.VERCEL_GIT_COMMIT_SHA;
  const validSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
  if (!previous || !current || !validSha.test(previous) || !validSha.test(current) || previous === current) return false;
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    if (git("rev-parse", "HEAD").trim() !== current) return false;
    git("merge-base", "--is-ancestor", previous, current);
    const paths = git("diff", "--name-only", "--no-renames", "-z", previous, current).split("\0").filter(Boolean);
    return paths.length > 0 && paths.every((path) =>
      path.startsWith("docs/") || (path.startsWith("apps/worker/") && path !== "apps/worker/package.json"));
  } catch {
    // Shallow clones, unavailable history and git errors always build.
    return false;
  }
}

const skip = canSkip();
console.log(skip ? "Skipping web build: only docs/worker files changed since the last successful deployment." : "Continuing web build: web/shared changes or insufficient history.");
process.exitCode = skip ? 0 : 1;
