import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("PWA-001 install contract", () => {
  it("publishes a standalone manifest with required PNG icon sizes", () => {
    const value = manifest();
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/");
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("uses one root service worker for both install shell and notifications", () => {
    const worker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    const pushHelper = readFileSync(
      resolve(process.cwd(), "features/notification/ui/push-subscription.ts"),
      "utf8",
    );
    expect(worker).toContain('addEventListener("fetch"');
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(pushHelper).toContain('register("/sw.js")');
    expect(pushHelper).not.toContain("notification-sw.js");
  });
});
