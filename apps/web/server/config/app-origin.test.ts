import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { appOriginForRequest, bindAppOrigin, readAppOriginBinding, requireSameAppOrigin } from "./app-origin";

describe("app origin compatibility", () => {
  it.each(["https://byus.kr", "https://www.byus.kr", "https://kyaa.io", "https://www.kyaa.io"])(
    "accepts production request origin %s while the canonical origin is kyaa.io",
    (origin) => expect(appOriginForRequest(new Request(`${origin}/callback`), "https://kyaa.io")).toBe(origin),
  );

  it("keeps local and preview origins restricted to their configured origin", () => {
    expect(appOriginForRequest(new Request("http://localhost:3000/callback"), "http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => appOriginForRequest(new Request("https://preview.example/callback"), "http://localhost:3000")).toThrow();
  });

  it("rejects untrusted production URLs and mismatched browser origins", () => {
    expect(() => appOriginForRequest(new Request("https://attacker.test/callback"), "https://kyaa.io")).toThrow();
    expect(() => requireSameAppOrigin(new Request("https://byus.kr/start", { headers: { origin: "https://kyaa.io" } }), "https://kyaa.io")).toThrow();
    expect(requireSameAppOrigin(new Request("https://byus.kr/start", { headers: { origin: "https://byus.kr" } }), "https://kyaa.io")).toBe("https://byus.kr");
  });

  it("binds new production state to its exact host while accepting legacy state", () => {
    expect(bindAppOrigin("state", "https://byus.kr")).toBe("b.state");
    expect(readAppOriginBinding("b.state", "https://byus.kr")).toBe("state");
    expect(readAppOriginBinding("state", "https://kyaa.io")).toBe("state");
    expect(() => readAppOriginBinding("b.state", "https://kyaa.io")).toThrow();
  });
});
