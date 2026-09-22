import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BYUS_BRAND_ICONS } from "./brand-icons";

describe("ByUs browser icon contract", () => {
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
});
