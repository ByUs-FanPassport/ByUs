import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

const singleLine = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[\x00-\x1f\x7f]/.test(s));
export const inquirySchema = z.object({
  idempotencyKey: z.uuid(), locale: z.enum(["ko", "en"]),
  name: singleLine(80), company: singleLine(120),
  email: z.email().max(254).refine((s) => !/[\r\n]/.test(s)),
  message: z.string().trim().min(1).max(4000).refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)),
  consent: z.literal(true),
}).strict();
export type InquiryInput = z.infer<typeof inquirySchema>;
export type InquiryRepository = { submit(input: InquiryInput, ipHash: string, payloadHash: string): Promise<boolean> };
export class InquiryError extends Error {
  constructor(readonly code: "INQUIRY_INVALID" | "INQUIRY_RATE_LIMITED" | "INQUIRY_IDEMPOTENCY_CONFLICT" | "INQUIRY_UNAVAILABLE") { super(code); }
}
const statuses = { INQUIRY_INVALID: 400, INQUIRY_RATE_LIMITED: 429, INQUIRY_IDEMPOTENCY_CONFLICT: 409, INQUIRY_UNAVAILABLE: 503 };
export function inquiryFailure(code: InquiryError["code"]) {
  return Response.json({ error: { code } }, { status: statuses[code], headers: { "cache-control": "no-store", ...(code === "INQUIRY_RATE_LIMITED" ? { "retry-after": "3600" } : {}) } });
}

export function normalizedClientIp(request: Request, vercel: boolean): string {
  if (!vercel) return "127.0.0.1";
  // Vercel overwrites this header at its edge. Never fall back to user XFF.
  const raw = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  const version = isIP(raw);
  if (version === 4) return raw;
  if (version === 6) return new URL(`http://[${raw}]/`).hostname.toLowerCase();
  throw new InquiryError("INQUIRY_UNAVAILABLE");
}
async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) throw new InquiryError("INQUIRY_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new InquiryError("INQUIRY_INVALID"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}
export function createInquiryHandler(deps: { repository: InquiryRepository; secret: string; vercel: boolean; localDevelopment?: boolean }) {
  return async (request: Request): Promise<Response> => {
    try {
      const origin = request.headers.get("origin");
      const allowed = new Set(["https://byus.kr", "https://www.byus.kr"]);
      const requestUrl = new URL(request.url);
      if (deps.localDevelopment && !deps.vercel && ["localhost", "127.0.0.1"].includes(requestUrl.hostname)) allowed.add(requestUrl.origin);
      if (!origin || !allowed.has(origin) || origin !== requestUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new InquiryError("INQUIRY_INVALID");
      if (!deps.vercel && !deps.localDevelopment) throw new InquiryError("INQUIRY_UNAVAILABLE");
      const parsed = inquirySchema.safeParse(await readBody(request));
      if (!parsed.success) throw new InquiryError("INQUIRY_INVALID");
      const input = parsed.data;
      const hash = (purpose: string, value: string) => createHmac("sha256", deps.secret).update(`byus-inquiry-v1:${purpose}:${value}`).digest("hex");
      const ipHash = hash("ip", normalizedClientIp(request, deps.vercel));
      const payloadHash = hash("payload", JSON.stringify([input.locale, input.name, input.company, input.email, input.message, input.consent]));
      const replayed = await deps.repository.submit(input, ipHash, payloadHash);
      return Response.json({ status: "accepted" }, { status: replayed ? 200 : 202, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof InquiryError) return inquiryFailure(error.code);
      if (error instanceof SyntaxError) return inquiryFailure("INQUIRY_INVALID");
      return inquiryFailure("INQUIRY_UNAVAILABLE");
    }
  };
}
