import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(process.cwd());

describe("brand-neutral Stamp assets", () => {
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
