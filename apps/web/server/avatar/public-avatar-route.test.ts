import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicAvatarImageHandler } from "./public-avatar-route";

const id = "11111111-1111-4111-8111-111111111111";
const request = (query = "revision=2") => new Request(`https://byus.kr/api/fan-avatars/${id}?${query}`);

describe("public avatar image route", () => {
  it("serves a current photo without owner authentication or cache retention", async () => {
    const publicImage = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]).buffer });
    const response = await createPublicAvatarImageHandler({ publicImage })(request(), id);
    expect(response.status).toBe(200);
    expect(publicImage).toHaveBeenCalledWith(id, 2);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(["", "revision=-1", "revision=01", "revision=1.2", "revision=2147483648", "revision=2&revision=3"])(
    "rejects invalid revisions before repository access: %s", async (query) => {
      const publicImage = vi.fn();
      const response = await createPublicAvatarImageHandler({ publicImage })(request(query), id);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(publicImage).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed IDs and hides missing, stale, and unavailable photos", async () => {
    const publicImage = vi.fn().mockResolvedValue(null);
    const handler = createPublicAvatarImageHandler({ publicImage });
    expect((await handler(request(), "../private")).status).toBe(404);
    expect(publicImage).not.toHaveBeenCalled();
    expect((await handler(request(), id)).status).toBe(404);
    publicImage.mockRejectedValue(new Error("private storage details"));
    const failed = await handler(request(), id);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.text()).toBe("");
  });
});
