import "server-only";
import { z } from "zod";
import type { AdminSession } from "../admin/admin-session-gate";
import type { InstagramConfig } from "./config";
import { constantTimeEqual, newSecret, secretHash, verifyInstagramSignedRequest } from "./crypto";
import { InstagramError, instagramId, instagramIdentitySchema, instagramLocale, instagramUsername, opaqueSecret, type InstagramLocale, type InstagramProvider } from "./model";
import type { InstagramRepository } from "./repository";
import { escapeHtml, failedPage, instagramPage, privateHeaders } from "./pages";
import type { createInstagramService } from "./service";

export interface InstagramRouteDependencies {
  config: InstagramConfig;
  repository: InstagramRepository;
  provider: InstagramProvider;
  service: ReturnType<typeof createInstagramService>;
  authorize(request: Request): Promise<AdminSession>;
}
type FlowCookie = "browser" | "pending";
function cookieName(config: InstagramConfig, kind: FlowCookie) {
  return `${config.origin.startsWith("https:") ? "__Host-" : ""}byus_ig_${kind}`;
}
function readCookie(request: Request, config: InstagramConfig, kind: FlowCookie) {
  const name = `${cookieName(config, kind)}=`;
  const found = (request.headers.get("cookie") ?? "").split(";").map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(name));
  if (found.length !== 1) throw new Error("Instagram browser session missing");
  return opaqueSecret.parse(found[0].slice(name.length));
}
function setCookie(config: InstagramConfig, kind: FlowCookie, value: string, clear = false) {
  return `${cookieName(config, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 1200}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
}
function clearCookies(response: Response, config: InstagramConfig) {
  response.headers.append("set-cookie", setCookie(config, "browser", "", true));
  response.headers.append("set-cookie", setCookie(config, "pending", "", true));
  return response;
}
function redirect(path: string) { return new Response(null, { status: 303, headers: { ...privateHeaders, location: path } }); }
function csrf(browser: string, secret: string) { return secretHash(`instagram-form:${browser}:${secret}`); }
function requireOrigin(request: Request, config: InstagramConfig) {
  if (request.headers.get("origin") !== config.origin) throw new Error("Invalid form origin");
}
async function smallForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("Invalid form");
  if (Number(request.headers.get("content-length") ?? 0) > 16384 || !request.body) throw new Error("Invalid form");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new Error("Invalid form"); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const values = new URLSearchParams(text);
  for (const key of values.keys()) if (values.getAll(key).length !== 1) throw new Error("Duplicate field");
  return values;
}
function oneQuery(request: Request, name: string) {
  const values = new URL(request.url).searchParams.getAll(name);
  if (values.length !== 1) throw new Error("Invalid callback");
  return values[0];
}
function queryLocale(request: Request): InstagramLocale | null {
  const values = new URL(request.url).searchParams.getAll("locale");
  if (values.length > 1) return null;
  const parsed = instagramLocale.safeParse(values[0] ?? "ko");
  return parsed.success ? parsed.data : null;
}
async function requireOperator(request: Request, deps: InstagramRouteDependencies) {
  const actor = await deps.authorize(request);
  if (actor.role !== "admin" && actor.role !== "operator") throw new Error("FORBIDDEN");
  return actor;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export function createInstagramInviteHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    try { await requireOperator(request, deps); } catch { return json({ error: { code: "FORBIDDEN" } }, 403); }
    try {
      const body = z.object({ celebrityId: z.string().uuid(), expectedUsername: instagramUsername, expectedUserId: instagramId.nullable().default(null), locale: instagramLocale.default("ko") }).strict().parse(await request.json());
      const invite = newSecret();
      await deps.repository.issueInvite({ celebrityId: body.celebrityId, username: body.expectedUsername, userId: body.expectedUserId, hash: secretHash(invite), locale: body.locale });
      return json({ connectionUrl: `${deps.config.origin}/connect/instagram/start?invite=${invite}&locale=${body.locale}`, expiresIn: 86400 });
    } catch { return json({ error: { code: "INSTAGRAM_INVITE_FAILED" } }, 400); }
  };
}

export function createInstagramStartHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    let pageLocale: InstagramLocale = queryLocale(request) ?? "ko";
    try {
      if (request.method === "GET") {
        const invite = opaqueSecret.parse(oneQuery(request, "invite"));
        const flow = await deps.repository.transition("peek_invite", secretHash(invite));
        if (!flow) throw new Error();
        pageLocale = flow.locale;
        const browser = newSecret();
        const content = pageLocale === "ko"
          ? `<p>사진과 릴스를 ByUs 팬페이지에 표시할 수 있도록 계정을 연결해 주세요.</p><dl class="account"><dt>연결할 팬페이지</dt><dd>${escapeHtml(flow.celebrity_name || flow.celebrity_slug || "")}</dd><dt>연결할 Instagram 계정</dt><dd>@${escapeHtml(flow.expected_username)}</dd></dl><p>Instagram에서 로그인하고 읽기 권한을 허용한 다음, 연결할 계정을 한 번 더 확인해 주세요.</p><form method="post" action="/connect/instagram/start"><input type="hidden" name="invite" value="${invite}"><input type="hidden" name="locale" value="ko"><input type="hidden" name="csrf" value="${csrf(browser, invite)}"><div class="actions"><button type="submit">Instagram으로 연결하기</button></div></form>`
          : `<p>Connect your account to show photos and reels on your ByUs fan page.</p><dl class="account"><dt>Fan page</dt><dd>${escapeHtml(flow.celebrity_name || flow.celebrity_slug || "")}</dd><dt>Instagram account</dt><dd>@${escapeHtml(flow.expected_username)}</dd></dl><p>Sign in to Instagram, allow read access, and confirm the account once more.</p><form method="post" action="/connect/instagram/start"><input type="hidden" name="invite" value="${invite}"><input type="hidden" name="locale" value="en"><input type="hidden" name="csrf" value="${csrf(browser, invite)}"><div class="actions"><button type="submit">Continue with Instagram</button></div></form>`;
        return instagramPage(pageLocale === "ko" ? "Instagram을 연결해 주세요" : "Connect Instagram", content, 200, { "set-cookie": setCookie(deps.config, "browser", browser) }, pageLocale);
      }
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
      requireOrigin(request, deps.config);
      const body = await smallForm(request);
      const invite = opaqueSecret.parse(body.get("invite"));
      const browser = readCookie(request, deps.config, "browser");
      if (!constantTimeEqual(body.get("csrf") ?? "", csrf(browser, invite))) throw new Error();
      const submittedLocale = body.get("locale");
      if (submittedLocale !== null) instagramLocale.parse(submittedLocale);
      const flow = await deps.repository.transition("peek_invite", secretHash(invite));
      if (!flow) throw new Error();
      pageLocale = flow.locale;
      const state = newSecret();
      await deps.repository.transition("start", secretHash(invite), secretHash(browser), { next_hash: secretHash(state) });
      return redirect(deps.provider.authorizationUrl(state));
    } catch { return failedPage(undefined, pageLocale); }
  };
}

export function createInstagramCallbackHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    let pageLocale: InstagramLocale = "ko";
    try {
      const state = opaqueSecret.parse(oneQuery(request, "state"));
      const browser = readCookie(request, deps.config, "browser");
      const stateFlow = await deps.repository.transition("peek_state", secretHash(state), secretHash(browser));
      if (!stateFlow) throw new Error();
      pageLocale = stateFlow.locale;
      const query = new URL(request.url).searchParams;
      if (query.has("error")) {
        if (query.getAll("error").length !== 1 || query.has("code")) throw new Error();
        await deps.repository.transition("consume", secretHash(state), secretHash(browser));
        await deps.repository.transition("cancel", secretHash(state), secretHash(browser));
        return clearCookies(pageLocale === "ko" ? instagramPage("연결을 취소했어요", "<p>Instagram 계정이 연결되지 않았어요. 다시 연결하려면 ByUs 담당자에게 새 링크를 요청해 주세요.</p>", 200, undefined, pageLocale) : instagramPage("Connection cancelled", "<p>Your Instagram account was not connected. Ask your ByUs contact for a new link to try again.</p>", 200, undefined, pageLocale), deps.config);
      }
      const code = z.string().min(1).max(4096).parse(oneQuery(request, "code"));
      const pending = await deps.service.callback(code, state, browser);
      const response = redirect(`/connect/instagram/confirm?locale=${pageLocale}`);
      response.headers.append("set-cookie", setCookie(deps.config, "pending", pending));
      return response;
    } catch (error) {
      const mismatch = error instanceof InstagramError && error.code === "ACCOUNT_MISMATCH";
      return clearCookies(failedPage(mismatch ? (pageLocale === "ko"
        ? "요청받은 Instagram 계정과 로그인한 계정이 달라요. 연결하지 않았으니 ByUs 담당자에게 새 링크를 요청해 주세요."
        : "The signed-in Instagram account does not match the requested account. Nothing was connected; ask your ByUs contact for a new link.") : undefined, pageLocale), deps.config);
    }
  };
}

export function createInstagramConfirmHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    let pageLocale: InstagramLocale = queryLocale(request) ?? "ko";
    try {
      const browser = readCookie(request, deps.config, "browser");
      const pending = readCookie(request, deps.config, "pending");
      const preview = await deps.repository.transition("peek_pending", secretHash(pending), secretHash(browser));
      if (!preview) throw new Error();
      pageLocale = preview.locale;
      if (request.method === "GET") {
        const flow = preview;
        const identity = instagramIdentitySchema.parse(flow.payload.identity);
        const content = pageLocale === "ko" ? `<p>팬페이지와 로그인한 계정이 맞는지 확인해 주세요.</p><dl class="account"><dt>연결할 팬페이지</dt><dd>${escapeHtml(flow.celebrity_name || flow.celebrity_slug || "")}</dd><dt>로그인한 Instagram 계정</dt><dd>@${escapeHtml(identity.username)}</dd></dl><p>연결하면 최신 사진과 릴스가 팬페이지에 표시돼요. ByUs는 게시물을 작성하거나 메시지를 보내지 않아요.</p><form method="post" action="/connect/instagram/confirm"><input type="hidden" name="csrf" value="${csrf(browser, pending)}"><div class="actions"><button name="action" value="confirm" type="submit">이 계정 연결하기</button><button class="secondary" name="action" value="cancel" type="submit">연결 취소</button></div></form>` : `<p>Confirm that the fan page and signed-in account are correct.</p><dl class="account"><dt>Fan page</dt><dd>${escapeHtml(flow.celebrity_name || flow.celebrity_slug || "")}</dd><dt>Signed-in Instagram account</dt><dd>@${escapeHtml(identity.username)}</dd></dl><p>After you connect, recent photos and reels can appear on the fan page. ByUs cannot publish posts or send messages.</p><form method="post" action="/connect/instagram/confirm"><input type="hidden" name="csrf" value="${csrf(browser, pending)}"><div class="actions"><button name="action" value="confirm" type="submit">Connect this account</button><button class="secondary" name="action" value="cancel" type="submit">Cancel</button></div></form>`;
        return instagramPage(pageLocale === "ko" ? "이 계정으로 연결할까요?" : "Connect this account?", content, 200, undefined, pageLocale);
      }
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
      requireOrigin(request, deps.config);
      const body = await smallForm(request);
      if (!constantTimeEqual(body.get("csrf") ?? "", csrf(browser, pending))) throw new Error();
      const action = z.enum(["confirm", "cancel"]).parse(body.get("action"));
      const flow = await deps.repository.transition(action, secretHash(pending), secretHash(browser));
      if (action === "cancel") return clearCookies(pageLocale === "ko" ? instagramPage("연결을 취소했어요", "<p>ByUs에 Instagram 계정을 연결하지 않았어요.</p><p>Instagram에서 허용한 접근 권한은 Instagram의 앱 및 웹사이트 설정에서 해제할 수 있어요.</p>", 200, undefined, pageLocale) : instagramPage("Connection cancelled", "<p>Your Instagram account was not connected to ByUs.</p><p>You can remove the access you granted in Instagram's Apps and Websites settings.</p>", 200, undefined, pageLocale), deps.config);
      // A failed media fetch must not turn a successful account confirmation into an error.
      if (flow) await deps.service.sync(flow.celebrity_id).catch(() => undefined);
      return clearCookies(pageLocale === "ko" ? instagramPage("Instagram을 연결했어요", "<p>연결이 완료되었어요. 최신 사진과 릴스는 확인이 끝나면 팬페이지에 표시돼요.</p><p>연결 해제는 ByUs 담당자에게 요청하거나 Instagram의 앱 및 웹사이트 설정에서 진행할 수 있어요.</p>", 200, undefined, pageLocale) : instagramPage("Instagram connected", "<p>The connection is complete. Recent photos and reels will appear on the fan page after verification.</p><p>To disconnect, contact ByUs or use Instagram's Apps and Websites settings.</p>", 200, undefined, pageLocale), deps.config);
    } catch { return failedPage(undefined, pageLocale); }
  };
}

export function createInstagramDisconnectHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    try { await requireOperator(request, deps); } catch { return json({ error: { code: "FORBIDDEN" } }, 403); }
    try {
      const { celebrityId } = z.object({ celebrityId: z.string().uuid() }).strict().parse(await request.json());
      return json(await deps.service.disconnect(celebrityId));
    } catch { return json({ error: { code: "INSTAGRAM_DISCONNECT_FAILED" } }, 400); }
  };
}

export function createInstagramDeletionHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    try {
      const body = await smallForm(request);
      const signed = verifyInstagramSignedRequest(body.get("signed_request") ?? "", deps.config.appSecret);
      const confirmation = newSecret();
      await deps.repository.deleteSubject(signed.user_id, new Date(signed.issued_at * 1000).toISOString(), secretHash(confirmation));
      return json({ url: `${deps.config.origin}/connect/instagram/deletion-status?id=${confirmation}&locale=ko`, confirmation_code: confirmation });
    } catch { return json({ error: { code: "INVALID_DELETION_REQUEST" } }, 400); }
  };
}

export function createInstagramDeletionStatusHandler(deps: InstagramRouteDependencies) {
  return async (request: Request) => {
    const locale = queryLocale(request);
    if (!locale) return failedPage(locale === null ? ("Invalid locale" as string) : undefined, "ko", 400);
    try {
      const id = opaqueSecret.parse(oneQuery(request, "id"));
      if (!await deps.repository.deletionStatus(secretHash(id))) throw new Error();
      return locale === "ko" ? instagramPage("Instagram 연결 데이터 삭제 완료", "<p>ByUs에 저장된 Instagram 연결 정보와 수집한 미디어 정보를 삭제했어요.</p>", 200, undefined, locale) : instagramPage("Instagram connection data deleted", "<p>We deleted the Instagram connection information and media data stored by ByUs.</p>", 200, undefined, locale);
    } catch { return locale === "ko" ? instagramPage("삭제 내역을 확인할 수 없어요", "<p>삭제 확인 링크를 다시 확인해 주세요.</p>", 404, undefined, locale) : instagramPage("Deletion record not found", "<p>Check the deletion confirmation link and try again.</p>", 404, undefined, locale); }
  };
}
