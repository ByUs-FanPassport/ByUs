import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";

const countries = new Set<string>(getCountries());
const singleLine = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\x00-\x1f\x7f]/u.test(value));
const nationality = z.string().trim().transform((value) => value.toUpperCase()).refine((value) => countries.has(value));
const rawSchema = z.object({
  idempotencyKey: z.uuid(),
  locale: z.enum(["ko", "en"]),
  koreanName: singleLine(80),
  englishName: singleLine(80),
  phone: singleLine(32),
  affiliation: singleLine(120),
  occupation: singleLine(120),
  email: z.email().max(254).refine((value) => !/[\r\n]/u.test(value)),
  nationality,
  consent: z.literal(true),
}).strict();

export type RsvpInput = Omit<z.infer<typeof rawSchema>, "phone"> & { phone: string };
export type RsvpRepository = { submit(input: RsvpInput, ipHash: string, payloadHash: string): Promise<void> };
export class RsvpError extends Error {
  constructor(readonly code: "RSVP_INVALID" | "RSVP_CLOSED" | "RSVP_RATE_LIMITED" | "RSVP_IDEMPOTENCY_CONFLICT" | "RSVP_UNAVAILABLE") { super(code); }
}
const statuses = { RSVP_INVALID: 400, RSVP_CLOSED: 410, RSVP_RATE_LIMITED: 429, RSVP_IDEMPOTENCY_CONFLICT: 409, RSVP_UNAVAILABLE: 503 };
export function rsvpFailure(code: RsvpError["code"]) {
  return Response.json({ error: { code } }, { status: statuses[code], headers: { "cache-control": "no-store", ...(code === "RSVP_RATE_LIMITED" ? { "retry-after": "3600" } : {}) } });
}

function clientIp(request: Request, vercel: boolean): string {
  if (!vercel) return "127.0.0.1";
  const raw = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  const version = isIP(raw);
  if (version === 4) return raw;
  if (version === 6) return new URL(`http://[${raw}]/`).hostname.toLowerCase();
  throw new RsvpError("RSVP_UNAVAILABLE");
}

async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) throw new RsvpError("RSVP_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new RsvpError("RSVP_INVALID"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}

export function createRsvpHandler(deps: { repository: RsvpRepository; secret: string; vercel: boolean; localDevelopment?: boolean; now?: () => number }) {
  return async (request: Request): Promise<Response> => {
    try {
      const origin = request.headers.get("origin");
      const allowed = new Set(["https://byus.kr", "https://www.byus.kr"]);
      const requestUrl = new URL(request.url);
      if (deps.localDevelopment && !deps.vercel && ["localhost", "127.0.0.1"].includes(requestUrl.hostname)) allowed.add(requestUrl.origin);
      if (!origin || !allowed.has(origin) || origin !== requestUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new RsvpError("RSVP_INVALID");
      if (!deps.vercel && !deps.localDevelopment) throw new RsvpError("RSVP_UNAVAILABLE");
      if ((deps.now?.() ?? Date.now()) >= Date.parse("2026-10-23T00:00:00+09:00")) throw new RsvpError("RSVP_CLOSED");
      const parsed = rawSchema.safeParse(await readBody(request));
      if (!parsed.success) throw new RsvpError("RSVP_INVALID");
      if (!/^\+?[0-9 ()-]+$/u.test(parsed.data.phone)) throw new RsvpError("RSVP_INVALID");
      const phone = parsePhoneNumberFromString(parsed.data.phone, "KR");
      if (!phone?.isValid() || phone.ext) throw new RsvpError("RSVP_INVALID");
      const input: RsvpInput = { ...parsed.data, phone: phone.number, email: parsed.data.email.toLowerCase(), nationality: parsed.data.nationality as CountryCode };
      const hash = (purpose: string, value: string) => createHmac("sha256", deps.secret).update(`byus-day-rsvp-v1:${purpose}:${value}`).digest("hex");
      const ipHash = hash("ip", clientIp(request, deps.vercel));
      const payloadHash = hash("payload", JSON.stringify([input.locale, input.koreanName, input.englishName, input.phone, input.affiliation, input.occupation, input.email, input.nationality, input.consent]));
      await deps.repository.submit(input, ipHash, payloadHash);
      return Response.json({ status: "accepted" }, { status: 202, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof RsvpError) return rsvpFailure(error.code);
      if (error instanceof SyntaxError) return rsvpFailure("RSVP_INVALID");
      return rsvpFailure("RSVP_UNAVAILABLE");
    }
  };
}
