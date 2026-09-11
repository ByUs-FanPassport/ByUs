import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSolapiWebhookHandler } from "./solapi-webhook-route";

const secret = "fixture-webhook-secret";
const signature = createHash("sha1").update(secret).digest("hex");
const receipt = { messageId: "M4Vsafe", groupId: "G4Vsafe", customFields: { deliveryKey: "11111111-1111-4111-8111-111111111111" } };
const request = (body: unknown, header = signature) => new Request("https://byus.test/api/notifications/solapi/webhook", { method: "POST", headers: { "content-type": "application/json", "x-solapi-secret": header }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("SOLAPI receipt webhook", () => {
  it("fails closed without a configured secret and rejects wrong authentication", async () => {
    const rpc = vi.fn();
    expect((await createSolapiWebhookHandler({ client: { rpc } })(request([receipt]))).status).toBe(503);
    expect((await createSolapiWebhookHandler({ secret, client: { rpc } })(request([receipt], "0".repeat(40)))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("records correlated candidates and ignores an uncorrelated false result", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const response = await createSolapiWebhookHandler({ secret, client: { rpc } })(request([receipt, receipt]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 2, recorded: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([[Array.from({ length: 101 }, () => receipt), 400], [[{ ...receipt, customFields: { deliveryKey: "bad" } }], 400], [[{ ...receipt, messageId: "bad id" }], 400], ["x".repeat(65537), 413]] as const)("rejects invalid or oversized input", async (body, status) => {
    expect((await createSolapiWebhookHandler({ secret, client: { rpc: vi.fn() } })(request(body))).status).toBe(status);
  });
  it("returns 503 on a real repository failure without logging payloads", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "private payload" } }));
    expect((await createSolapiWebhookHandler({ secret, client: { rpc } })(request([receipt]))).status).toBe(503);
  });
});
