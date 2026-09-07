import "server-only";
import { createHash } from "node:crypto";

export const privateHeaders = {
  "cache-control": "no-store, max-age=0",
  // no-referrer would turn native POST Origin into null in Chromium.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const styles = `:root{color-scheme:light;font-family:Pretendard,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:oklch(18% 0 0);background:#fff}*{box-sizing:border-box}body{margin:0;min-height:100svh;padding:48px 24px;display:grid;place-items:center}main{width:min(100%,480px)}.brand{font-size:24px;font-weight:850;letter-spacing:-.04em;margin:0 0 56px}h1{font-size:28px;letter-spacing:-.035em;line-height:1.3;margin:0 0 16px}p{font-size:16px;line-height:1.7;margin:12px 0;color:oklch(40% 0 0)}.account{border:1px solid oklch(90% 0 0);border-radius:16px;padding:20px;margin:28px 0;overflow-wrap:anywhere}dl{margin:0}dt{font-size:13px;color:oklch(48% 0 0);margin-top:20px}dt:first-child{margin:0}dd{margin:6px 0 0;font-size:18px;font-weight:700}.actions{display:grid;gap:12px;margin-top:28px}button,.button{display:block;width:100%;border:1px solid oklch(18% 0 0);border-radius:12px;min-height:48px;padding:12px 18px;font:inherit;font-size:16px;font-weight:650;text-align:center;text-decoration:none;background:oklch(18% 0 0);color:#fff;cursor:pointer}button.secondary{background:white;color:oklch(18% 0 0);border-color:oklch(90% 0 0)}a{color:inherit;text-underline-offset:4px}:focus-visible{outline:2px solid oklch(18% 0 0);outline-offset:4px}.foot{margin-top:32px;font-size:13px;color:oklch(48% 0 0)}@media(max-width:400px){body{padding:32px 20px}.brand{margin-bottom:40px}h1{font-size:26px}}`;

// Standalone route HTML deliberately bypasses app analytics and third-party auth scripts.
export function instagramPage(title: string, content: string, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(privateHeaders);
  headers.set("content-type", "text/html; charset=utf-8");
  const styleHash = createHash("sha256").update(styles).digest("base64");
  headers.set("content-security-policy", `default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self' https://www.instagram.com; base-uri 'none'; frame-ancestors 'none'`);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ByUs</title><style>${styles}</style></head><body><main><div class="brand">ByUs</div><h1>${escapeHtml(title)}</h1>${content}<p class="foot"><a href="/privacy">개인정보처리방침</a></p></main></body></html>`, { status, headers });
}

export function unavailablePage() {
  return instagramPage("Instagram 연결을 준비하고 있어요", "<p>아직 계정 연결을 시작할 수 없어요. ByUs 담당자에게 연결 링크를 요청해 주세요.</p>", 503);
}

export function failedPage(message = "연결 링크가 만료되었거나 이미 사용되었어요. ByUs 담당자에게 새 링크를 요청해 주세요.") {
  return instagramPage("계정을 연결하지 못했어요", `<p role="alert">${escapeHtml(message)}</p>`, 400);
}
