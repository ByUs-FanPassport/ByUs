import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createManifest } from "../components/pwa-manifest";

describe("PWA-001 install contract", () => {
  it("publishes a standalone manifest with required PNG icon sizes", async () => {
    const value = createManifest("ko");
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/?locale=ko");
    expect(value.id).toBe("/");
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("keeps installation identity while launching in the selected language", async () => {
    const value = createManifest("en");
    expect(value.lang).toBe("en");
    expect(value.start_url).toBe("/?locale=en");
    expect(value.id).toBe("/");
    expect(value.description).toContain("Record moments with each of your favorites");
  });

  it("publishes opaque Apple and PWA icons matching the wordmark SVG", async () => {
    const source = readFileSync(resolve(process.cwd(), "public/byus-app-icon.svg"));
    for (const [file, size] of [
      ["apple-touch-icon.png", 180],
      ["byus-app-icon-192.png", 192],
      ["byus-app-icon-512.png", 512],
    ] as const) {
      const icon = sharp(resolve(process.cwd(), "public", file));
      expect(await icon.metadata()).toMatchObject({ width: size, height: size });
      expect((await icon.stats()).isOpaque).toBe(true);
      const expected = await sharp(source).resize(size, size).removeAlpha().raw().toBuffer();
      expect(await icon.removeAlpha().raw().toBuffer()).toEqual(expected);
    }
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
