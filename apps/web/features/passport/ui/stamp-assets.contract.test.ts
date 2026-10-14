import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(process.cwd());

describe("brand-neutral Stamp assets", () => {
  const credentialArtwork = [
    "passport", "knowledge", "reservation", "attendance", "survey", "membership", "reaction", "mission",
    "welcome", "first_comment", "subscription", "support", "share", "invite", "daily_checkin",
  ];

  it("keeps every public credential artwork byte-identical to the issued v2 bundle", async () => {
    const sourceDirectory = path.resolve(webRoot, "../worker/assets/kyaa-credentials-v2");
    const publicDirectory = path.join(webRoot, "public/images/credentials/v2");

    await Promise.all(credentialArtwork.map(async (key) => {
      const [source, published] = await Promise.all([
        readFile(path.join(sourceDirectory, `${key}.png`)),
        readFile(path.join(publicDirectory, `${key}.png`)),
      ]);
      expect(published.equals(source), key).toBe(true);
    }));
  });

  it("does not ship celebrity or brand names in public Stamp filenames", async () => {
    const stampDirectory = path.join(webRoot, "public/images/stamps");
    const filenames = await readdir(stampDirectory).catch(() => []);

    expect(filenames.join("\n")).not.toMatch(/kara|nualeaf/i);
  });

  it("keeps the shared registry free of legacy branded asset references", async () => {
    const registrySource = await readFile(
      path.join(webRoot, "features/passport/ui/passport-stamp-artwork.tsx"),
      "utf8",
    );

    expect(registrySource).not.toMatch(/kara|nualeaf/i);
  });
});
