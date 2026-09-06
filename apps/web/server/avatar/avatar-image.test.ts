import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import sharp from "sharp";
import {
  AvatarImageError,
  MAX_AVATAR_MULTIPART_BYTES,
  fetchGoogleAvatarImage,
  fetchGoogleUserInfo,
  normalizeAvatarImage,
  readAvatarMultipartBody,
} from "./avatar-image";

describe("avatar image boundaries", () => {
  it("auto-orients first, applies the agreed normalized square crop, and strips metadata", async () => {
    const pixels = Buffer.alloc(80 * 40 * 3);
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 80; x += 1) {
        const offset = (y * 80 + x) * 3;
        pixels[offset] = x < 40 ? 255 : 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = x < 40 ? 0 : 255;
      }
    }
    const source = await sharp(pixels, { raw: { width: 80, height: 40, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const output = await normalizeAvatarImage(new Uint8Array(source), {
      x: 0,
      y: 0.5,
      size: 1,
    });
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ width: 512, height: 512, format: "webp" });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    const stats = await sharp(output).stats();
    expect(stats.channels[2]!.mean).toBeGreaterThan(220);
    expect(stats.channels[0]!.mean).toBeLessThan(35);
  });

  it("rejects crop coordinates that overflow the EXIF-oriented source", async () => {
    const source = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "#fff" },
    }).png().toBuffer();
    await expect(
      normalizeAvatarImage(new Uint8Array(source), { x: 0.75, y: 0, size: 1 }),
    ).rejects.toEqual(new AvatarImageError("INVALID_CROP"));
  });

  it("clamps rounding at a valid odd-pixel bottom-right crop edge", async () => {
    const source = await sharp({
      create: { width: 63, height: 63, channels: 3, background: "#fff" },
    }).png().toBuffer();
    const output = await normalizeAvatarImage(new Uint8Array(source), {
      x: 0.5,
      y: 0.5,
      size: 0.5,
    });
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 512, height: 512 });
  });

  it("rejects a multipart stream once the 4.25 MiB aggregate bound is crossed", async () => {
    const request = new Request("https://byus.test/api/me/avatar", {
      method: "PUT",
      headers: { "content-length": String(MAX_AVATAR_MULTIPART_BYTES + 1) },
      body: new Uint8Array([1]),
      duplex: "half",
    } as RequestInit);
    await expect(readAvatarMultipartBody(request)).rejects.toEqual(
      new AvatarImageError("BODY_TOO_LARGE"),
    );
  });

  it("enforces the aggregate bound from streamed bytes when Content-Length is absent", async () => {
    const chunk = new Uint8Array(Math.floor(MAX_AVATAR_MULTIPART_BYTES / 2) + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("https://byus.test/api/me/avatar", {
      method: "PUT",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readAvatarMultipartBody(request)).rejects.toEqual(
      new AvatarImageError("BODY_TOO_LARGE"),
    );
  });

  it("uses only the fixed userinfo endpoint and never forwards credentials to the image host", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: "google-1", picture: "https://lh3.googleusercontent.com/a/photo" }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } }));
    await expect(fetchGoogleUserInfo("secret-token", fetcher)).resolves.toEqual({
      sub: "google-1",
      picture: "https://lh3.googleusercontent.com/a/photo",
    });
    await fetchGoogleAvatarImage("https://lh3.googleusercontent.com/a/photo", fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://openidconnect.googleapis.com/v1/userinfo");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { authorization: "Bearer secret-token" },
    });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { accept: "image/jpeg,image/png,image/webp" },
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty("authorization");
  });

  it.each([
    "http://lh3.googleusercontent.com/a/photo",
    "https://googleusercontent.com/a/photo",
    "https://googleusercontent.com.evil.test/a/photo",
    "https://user:pass@lh3.googleusercontent.com/a/photo",
    "https://lh3.googleusercontent.com:444/a/photo",
  ])("skips an unsafe Google image URL: %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchGoogleAvatarImage(url, fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the timeout active while a Google response body is streaming", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start() {},
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(body, { status: 200 });
      });
      const pending = fetchGoogleUserInfo("secret", fetcher);
      await vi.advanceTimersByTimeAsync(4_001);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
