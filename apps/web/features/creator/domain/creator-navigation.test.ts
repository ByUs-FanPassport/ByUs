import { resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { creatorHomeHref, creatorSlugFromHomePath, isCreatorHandle, RESERVED_CREATOR_HANDLES } from "./creator-navigation";

describe("creator public handles", () => {
  it.each(["elina", "changha", "yuna", "jenny-jeong", "aryeom", "park-myungho", "ifewknow", "thisisj-official", "new-creator-2026"])("preserves %s without aliases", (slug) => {
    expect(creatorHomeHref(slug)).toBe(`/${slug}`);
    expect(creatorHomeHref(slug, "en")).toBe(`/${slug}?locale=en`);
    expect(creatorSlugFromHomePath(`/${slug}`)).toBe(slug);
    expect(creatorSlugFromHomePath(`/c/${slug}`)).toBe(slug);
    expect(creatorSlugFromHomePath(`/c/${slug}/verify`)).toBeNull();
  });
  it.each([...RESERVED_CREATOR_HANDLES, "이퓨", "Elina", "../my", "a_b", "-elina", "elina-", ""])("rejects reserved or invalid %s", (slug) => {
    expect(isCreatorHandle(slug)).toBe(false);
    expect(creatorSlugFromHomePath(`/${slug}`)).toBeNull();
  });
  it("keeps SQL registration rules aligned with the application", () => {
    const migrationDirectory = resolve(process.cwd(), "../../supabase/migrations");
    const latestPolicyMigration = readdirSync(migrationDirectory)
      .filter((name) => name.includes("celebrity_public_handle") && name.endsWith(".sql"))
      .sort()
      .at(-1);
    expect(latestPolicyMigration).toBeDefined();
    const sql = readFileSync(resolve(migrationDirectory, latestPolicyMigration!), "utf8");
    for (const array of sql.matchAll(/array\[([\s\S]*?)\]::text\[\]/g)) {
      const values = [...array[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
      expect(values.sort()).toEqual([...RESERVED_CREATOR_HANDLES].sort());
    }
  });
  it("reserves every static top-level app route and public directory", () => {
    for (const directory of ["app", "public"]) {
      const entries = readdirSync(resolve(process.cwd(), directory), { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory() && /^[a-z0-9-]+$/.test(item.name))) {
        expect(RESERVED_CREATOR_HANDLES, `${directory}/${entry.name}`).toContain(entry.name);
      }
    }
  });
});
