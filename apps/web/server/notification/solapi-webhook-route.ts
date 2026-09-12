import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{2,128}$/;
const receiptSchema = z.object({
  messageId: z.string().regex(SAFE_PROVIDER_ID),
  groupId: z.string().regex(SAFE_PROVIDER_ID),
  type: z.string().optional(),
  customFields: z.object({ deliveryKey: z.string().uuid().optional() }).passthrough().optional(),
}).passthrough();
const payloadSchema = z.array(receiptSchema).min(1).max(100);

export interface SolapiWebhookDependencies {
  secret?: string;
  client: NotificationConnectionRpcClient;
}

async function boundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function authentic(request: Request, secret: string): boolean {
  const received = request.headers.get("x-solapi-secret");
  if (!received || !/^[a-f0-9]{40}$/i.test(received)) return false;
  const expected = createHash("sha1").update(secret).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSolapiWebhookHandler(dependencies: SolapiWebhookDependencies) {
  return async (request: Request) => {
    const headers = { "cache-control": "no-store" };
    if (!dependencies.secret) return Response.json({ error: { code: "SOLAPI_WEBHOOK_UNAVAILABLE" } }, { status: 503, headers });
    if (!authentic(request, dependencies.secret)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
    let receipts: z.infer<typeof payloadSchema>;
    try {
      const bytes = await boundedBody(request);
      receipts = payloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch (error) {
      const status = error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400;
      return Response.json({ error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" } }, { status, headers });
    }
    try {
      let recorded = 0;
      for (const receipt of receipts) {
        // SINGLE-REPORT covers the whole provider account, including SMS OTPs.
        // Acknowledge unrelated results without making them Alimtalk candidates.
        if ((receipt.type && receipt.type !== "ATA") || !receipt.customFields?.deliveryKey) continue;
        const { data, error } = await dependencies.client.rpc("record_kakao_notification_receipt", {
          p_delivery_id: receipt.customFields.deliveryKey,
          p_provider_message_id: receipt.messageId,
          p_group_id: receipt.groupId,
        });
        if (error || typeof data !== "boolean") throw new Error("receipt unavailable");
        if (data) recorded += 1;
      }
      return Response.json({ accepted: receipts.length, recorded }, { status: 200, headers });
    } catch {
      return Response.json({ error: { code: "SOLAPI_WEBHOOK_UNAVAILABLE" } }, { status: 503, headers });
    }
  };
}
