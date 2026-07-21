import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "app/api/auth/session/route.ts"),
  "utf8",
);

describe("auth session log privacy contract", () => {
  it("logs only bounded error metadata and never the upstream message", () => {
    const logBlock = route.slice(
      route.indexOf('console.error("[auth/session] synchronization failed"'),
      route.indexOf("const status ="),
    );

    expect(logBlock).toContain("name:");
    expect(logBlock).toContain("code:");
    expect(logBlock).not.toContain("error.message");
    expect(logBlock).not.toContain("authorization");
  });
});
