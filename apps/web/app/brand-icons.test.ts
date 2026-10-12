import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BYUS_BRAND_ICONS } from "./brand-icons";

describe("kyaa browser icon contract", () => {
  it("publishes the approved multi-size favicon and Apple touch icon", () => {
    expect(BYUS_BRAND_ICONS).toEqual({
      icon: [
        { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      ],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    });
  });

  it("serves a valid browser favicon", () => {
    const appFavicon = readFileSync(resolve(process.cwd(), "app/favicon.ico"));
    expect(appFavicon.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(appFavicon.length).toBeGreaterThan(6);
  });

  it("derives each PNG favicon from the approved app icon", async () => {
    const source = readFileSync(resolve(process.cwd(), "public/kyaa-app-icon-1024.png"));
    for (const size of [16, 32, 48] as const) {
      const icon = sharp(resolve(process.cwd(), `public/favicon-${size}.png`));
      expect(await icon.metadata()).toMatchObject({ width: size, height: size });
      expect(await icon.raw().toBuffer()).toEqual(
        await sharp(source).resize(size, size).raw().toBuffer(),
      );
    }
  });

  it("keeps legacy public logo URLs on the current assets", () => {
    for (const [legacy, current] of [
      ["images/guest-home/byus-wordmark.svg", "images/guest-home/kyaa-wordmark.svg"],
      ["images/guest-home/byus-wordmark-transparent.png", "images/guest-home/kyaa-wordmark-transparent.png"],
    ] as const) {
      expect(readFileSync(resolve(process.cwd(), "public", legacy))).toEqual(
        readFileSync(resolve(process.cwd(), "public", current)),
      );
    }
    expect(readFileSync(resolve(process.cwd(), "public/byus-app-icon.svg"), "utf8"))
      .toContain('/kyaa-app-icon-1024.png');
  });
});
