import { describe, expect, it, vi } from "vitest";
import { createGetRafflesHandler } from "./raffle-route";

describe("raffle public route", () => {
  it("returns the stable raffle list contract", async () => {
    const list = vi.fn().mockResolvedValue({ raffles: [] });
    const response = await createGetRafflesHandler(
      { list },
      () => new Date("2026-09-08T00:00:00Z"),
    )(new Request("https://byus.kr/api/celebrities/banksy/raffles?locale=en"), {
      celebritySlug: "banksy",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ raffles: [] });
    expect(list).toHaveBeenCalledWith({
      celebritySlug: "banksy",
      locale: "en",
      now: new Date("2026-09-08T00:00:00Z"),
    });
  });

  it("rejects invalid slugs without reading", async () => {
    const list = vi.fn();
    const response = await createGetRafflesHandler({ list })(
      new Request("https://byus.kr/api/celebrities/nope!/raffles"),
      { celebritySlug: "nope!" },
    );
    expect(response.status).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });
});
