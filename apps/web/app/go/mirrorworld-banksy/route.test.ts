import { expect, it, vi } from "vitest";
import { MIRRORWORLD_BANKSY_LINK_ID } from "@/features/analytics/domain/banksy-campaign";
const resolve = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 302 })));
vi.mock("../../t/[id]/route", () => ({ GET: resolve }));
import { GET, HEAD } from "./route";
it.each([["GET", GET], ["HEAD", HEAD]] as const)("preserves %s and resolves the managed Mirrorworld link", async (method, handler) => {
  const request = new Request("https://byus.kr/go/mirrorworld-banksy", { method });
  expect((await handler(request)).status).toBe(302);
  const [received, context] = resolve.mock.calls.at(-1)! as unknown as [Request, {params:Promise<{id:string}>}];
  expect(received).toBe(request);
  expect(await context.params).toEqual({id:MIRRORWORLD_BANKSY_LINK_ID});
});
