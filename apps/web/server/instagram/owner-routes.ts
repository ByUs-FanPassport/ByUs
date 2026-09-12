import "server-only";
import { z } from "zod";
import type { InstagramConfig } from "./config";
import { newSecret, secretHash } from "./crypto";
import { instagramLocale, opaqueSecret, type InstagramProvider } from "./model";
import type { InstagramOwnerRepository } from "./owner-repository";
import type { createInstagramOwnerService } from "./owner-service";
import { privateHeaders } from "./pages";

export interface InstagramOwnerDependencies {
  config: InstagramConfig;
  provider: InstagramProvider;
  ownerRepository: InstagramOwnerRepository;
  ownerService: ReturnType<typeof createInstagramOwnerService>;
  authorizeFan(request: Request): Promise<{ appUserId: string }>;
}

type CookieKind = "browser" | "pending";
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { ...privateHeaders, ...headers } });
const cookieName = (config: InstagramConfig, kind: CookieKind) => `${config.origin.startsWith("https:") ? "__Host-" : ""}byus_ig_owner_${kind}`;
const setCookie = (config: InstagramConfig, kind: CookieKind, value: string, clear = false) =>
  `${cookieName(config, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 1200}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
function withCookies(response: Response, ...cookies: string[]) {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

function readCookie(request: Request, config: InstagramConfig, kind: CookieKind) {
  const prefix = `${cookieName(config, kind)}=`;
  const values = (request.headers.get("cookie") ?? "").split(";").map((value) => value.trim()).filter((value) => value.startsWith(prefix));
  if (values.length !== 1) throw new Error("OWNER_FLOW");
  return opaqueSecret.parse(values[0].slice(prefix.length));
}
async function actor(request: Request, dependencies: InstagramOwnerDependencies) {
  return (await dependencies.authorizeFan(request)).appUserId;
}
function localeFrom(request: Request) {
  return instagramLocale.catch("ko").parse(new URL(request.url).searchParams.get("locale") ?? "ko");
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 401 || status === 403) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  if (status === 503 || message.toLowerCase().includes("unavailable")) return json({ error: { code: "INSTAGRAM_UNAVAILABLE" } }, 503);
  return json({ error: { code: message.includes("MISMATCH") ? "ACCOUNT_MISMATCH" : "CONFLICT" } }, 409);
}
export const isOwnerInstagramState = (value: string | null) => value?.startsWith("owner.") ?? false;

export function createInstagramOwnerStartHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try {
      const appUserId = await actor(request, dependencies);
      const body = z.object({ locale: instagramLocale }).strict().parse(await request.json());
      const browser = newSecret();
      const state = newSecret();
      await dependencies.ownerRepository.transition("start", secretHash(state), appUserId, secretHash(browser), { locale: body.locale });
      return withCookies(json({ authorizationUrl: dependencies.provider.authorizationUrl(`owner.${state}`) }),
        setCookie(dependencies.config, "browser", browser), setCookie(dependencies.config, "pending", "", true));
    } catch (error) { return failure(error); }
  };
}

export function createInstagramOwnerCallbackHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    let locale: "ko" | "en" = "ko";
    try {
      const query = new URL(request.url).searchParams;
      const states = query.getAll("state");
      if (states.length !== 1 || !states[0].startsWith("owner.")) throw new Error("OWNER_FLOW");
      const state = opaqueSecret.parse(states[0].slice(6));
      const browser = readCookie(request, dependencies.config, "browser");
      locale = (await dependencies.ownerRepository.transition("peek_state", secretHash(state), null, secretHash(browser))).locale;
      if (query.has("error")) {
        if (query.getAll("error").length !== 1 || query.has("code")) throw new Error("OWNER_FLOW");
        await dependencies.ownerRepository.transition("consume", secretHash(state), null, secretHash(browser));
        await dependencies.ownerRepository.transition("cancel", secretHash(state), null, secretHash(browser));
        return withCookies(new Response(null, { status: 303, headers: { ...privateHeaders, location: `/connect/instagram?error=CANCELLED&locale=${locale}` } }),
          setCookie(dependencies.config, "browser", "", true), setCookie(dependencies.config, "pending", "", true));
      }
      const codes = query.getAll("code");
      if (codes.length !== 1) throw new Error("OWNER_FLOW");
      const code = z.string().min(1).max(4096).parse(codes[0]);
      const pending = await dependencies.ownerService.callback(code, state, browser);
      return withCookies(new Response(null, { status: 303, headers: { ...privateHeaders, location: `/connect/instagram?step=confirm&locale=${locale}` } }),
        setCookie(dependencies.config, "pending", pending));
    } catch (error) {
      const code = error instanceof Error && error.message.includes("MISMATCH") ? "ACCOUNT_MISMATCH" : "CONNECTION_FAILED";
      return withCookies(new Response(null, { status: 303, headers: { ...privateHeaders, location: `/connect/instagram?error=${code}&locale=${locale}` } }),
        setCookie(dependencies.config, "browser", "", true), setCookie(dependencies.config, "pending", "", true));
    }
  };
}

export function createInstagramOwnerStatusHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try { return json({ connections: await dependencies.ownerRepository.accounts(await actor(request, dependencies), localeFrom(request)) }); }
    catch (error) { return failure(error); }
  };
}
export function createInstagramOwnerPendingHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try {
      const appUserId = await actor(request, dependencies);
      const browser = readCookie(request, dependencies.config, "browser");
      const pending = readCookie(request, dependencies.config, "pending");
      const flow = await dependencies.ownerRepository.transition("peek_pending", secretHash(pending), appUserId, secretHash(browser));
      return json({ account: flow.account ?? null });
    } catch (error) { return failure(error); }
  };
}
export function createInstagramOwnerConfirmHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try {
      const appUserId = await actor(request, dependencies);
      const browser = readCookie(request, dependencies.config, "browser");
      const pending = readCookie(request, dependencies.config, "pending");
      const body = z.object({ action: z.enum(["confirm", "cancel"]) }).strict().parse(await request.json());
      const preview = await dependencies.ownerRepository.transition("peek_pending", secretHash(pending), appUserId, secretHash(browser));
      await dependencies.ownerRepository.transition(body.action, secretHash(pending), appUserId, secretHash(browser));
      const account = body.action === "confirm"
        ? (await dependencies.ownerRepository.accounts(appUserId, preview.locale)).find((item) => item.celebrityId === preview.celebrity_id) ?? null
        : null;
      return withCookies(json({ account }), setCookie(dependencies.config, "browser", "", true), setCookie(dependencies.config, "pending", "", true));
    } catch (error) { return failure(error); }
  };
}
export function createInstagramOwnerSettingsHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try {
      const input = z.object({ celebrityId: z.string().uuid(), generation: z.string().uuid(), liveEnabled: z.boolean() }).strict().parse(await request.json());
      return json({ account: await dependencies.ownerRepository.settings(await actor(request, dependencies), { ...input, locale: localeFrom(request) }) });
    } catch (error) { return failure(error); }
  };
}
export function createInstagramOwnerDisconnectHandler(dependencies: InstagramOwnerDependencies) {
  return async (request: Request) => {
    try {
      const input = z.object({ celebrityId: z.string().uuid(), generation: z.string().uuid() }).strict().parse(await request.json());
      return json(await dependencies.ownerService.disconnect(await actor(request, dependencies), input.celebrityId, input.generation));
    } catch (error) { return failure(error); }
  };
}
