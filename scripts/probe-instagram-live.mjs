// Read-only capability probe. Credentials stay in a private local JSON file.
// node scripts/probe-instagram-live.mjs --credentials <file> --username <owner> --expect offline|live
import { readFile, stat } from "node:fs/promises";

const instagramIdPattern = /^\d{1,30}$/;
const instagramUsernamePattern = /^[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?$/;

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function livePermalink(value, username) {
  if (typeof value !== "string" || !instagramUsernamePattern.test(username) || username.includes("..")) return null;
  try {
    const url = new URL(value);
    const match = /^\/stories\/([A-Za-z0-9._]{1,30})\/(\d{1,30})\/?$/.exec(url.pathname);
    return url.href === value && url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && !url.pathname.includes("//") &&
      match && match[1].toLowerCase() === username.toLowerCase() && instagramIdPattern.test(match[2])
      ? url.href : null;
  } catch { return null; }
}

function paginationState(body) {
  if (!Object.hasOwn(body, "paging")) return "none";
  const paging = object(body.paging);
  if (!paging || Object.keys(paging).length === 0 ||
      Object.keys(paging).some((key) => !["cursors", "next", "previous"].includes(key))) return "invalid";
  if (["next", "previous"].some((key) => Object.hasOwn(paging, key) && typeof paging[key] !== "string")) return "invalid";
  if (Object.hasOwn(paging, "cursors")) {
    const cursors = object(paging.cursors);
    if (!cursors || Object.keys(cursors).length === 0 ||
        Object.keys(cursors).some((key) => !["before", "after"].includes(key)) ||
        Object.values(cursors).some((value) => typeof value !== "string")) return "invalid";
  }
  return "present";
}

const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== "--credentials" || args[2] !== "--username" ||
    args[4] !== "--expect" || !/^[a-z0-9._]{1,30}$/i.test(args[3]) ||
    !["offline", "live"].includes(args[5])) {
  console.error("Usage: --credentials <private-json-file> --username <owner> --expect offline|live");
  process.exit(2);
}

async function main() {
  const info = await stat(args[1]);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16384) throw Error("PRIVATE_CREDENTIAL_FILE_REQUIRED");
  const credentials = JSON.parse(await readFile(args[1], "utf8"));
  const token = credentials.accessToken;
  const version = credentials.graphVersion;
  if (typeof token !== "string" || token.length < 20 || !/^[A-Za-z0-9_.-]+$/.test(token) ||
      typeof version !== "string" || !/^v\d+\.0$/.test(version)) throw Error("INVALID_CREDENTIAL_FORMAT");
  const root = `https://graph.instagram.com/${version}`;
  async function get(path, fields) {
    try {
      const url = new URL(`${root}/${path}`);
      url.searchParams.set("fields", fields);
      if (path.endsWith("/live_media")) url.searchParams.set("limit", "2");
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` }, redirect: "error",
        cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 65536) throw Error("RESPONSE_TOO_LARGE");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok || body.error) {
        // No raw body/message/URL: upstream errors can echo credentials or inputs.
        const message = typeof body.error?.message === "string" ? body.error.message : "";
        const reason = /nonexisting field.*live_media/i.test(message) ? "LIVE_EDGE_NOT_AVAILABLE"
          : /nonexisting field|unknown field/i.test(message) ? "FIELD_NOT_AVAILABLE"
          : /unsupported get request/i.test(message) ? "OBJECT_OR_PERMISSION_UNAVAILABLE"
          : /permission/i.test(message) ? "PERMISSION_REQUIRED"
          : /expired|invalid.*token/i.test(message) ? "TOKEN_INVALID_OR_EXPIRED" : "UPSTREAM_ERROR";
        return { ok: false, httpStatus: response.status,
          reason,
          code: Number.isSafeInteger(body.error?.code) ? body.error.code : null,
          subcode: Number.isSafeInteger(body.error?.error_subcode) ? body.error.error_subcode : null };
      }
      return { ok: true, httpStatus: response.status, body };
    } catch { return { ok: false, error: "TRANSPORT_OR_RESPONSE_FAILURE" }; }
  }
  const profile = await get("me", "id,user_id,username,account_type");
  if (!profile.ok) {
    console.log(JSON.stringify({ phase: "identity", ...profile }));
    return false;
  }
  const identity = profile.body;
  if (typeof identity.username !== "string" || identity.username.toLowerCase() !== args[3].toLowerCase() ||
      !/^\d{1,30}$/.test(String(identity.user_id ?? "")) ||
      !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(identity.account_type)) {
    console.log(JSON.stringify({ phase: "identity", error: "ACCOUNT_MISMATCH_OR_INVALID_IDENTITY" }));
    return false;
  }
  const observedAt = new Date().toISOString();
  const live = await get(`${identity.user_id}/live_media`, "id,media_type,media_product_type,permalink,timestamp,username");
  const base = { observedAt, version, username: identity.username, accountType: identity.account_type, expected: args[5] };
  if (!live.ok) {
    console.log(JSON.stringify({ ...base, phase: "live_media", ...live, state: "unavailable" }));
    return false;
  }
  const envelope = object(live.body);
  if (!envelope || Object.keys(envelope).some((key) => !["data", "paging"].includes(key)) || !Array.isArray(envelope.data)) {
    console.log(JSON.stringify({ ...base, phase: "live_media", httpStatus: live.httpStatus, state: "unavailable",
      matches: false, media: [], hasMore: false }));
    return false;
  }
  const paging = paginationState(envelope);
  if (paging === "invalid") {
    console.log(JSON.stringify({ ...base, phase: "live_media", httpStatus: live.httpStatus, state: "unavailable",
      matches: false, media: [], hasMore: false }));
    return false;
  }
  const media = envelope.data.map((value) => {
    const row = object(value) ?? {};
    const permalink = livePermalink(row.permalink, args[3]);
    const timestamp = typeof row.timestamp === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(row.timestamp) &&
      Number.isFinite(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null;
    return {
      id: instagramIdPattern.test(String(row.id ?? "")) ? String(row.id) : null,
      mediaType: ["BROADCAST", "VIDEO", "IMAGE", "CAROUSEL_ALBUM"].includes(row.media_type) ? row.media_type : null,
      mediaProductType: ["FEED", "LIVE"].includes(row.media_product_type) ? row.media_product_type : null,
      permalink,
      actualStartTime: timestamp,
      usernameMatches: typeof row.username === "string" && row.username.toLowerCase() === args[3].toLowerCase(),
    };
  });
  const hasMore = paging === "present";
  const validLive = media.length === 1 && !hasMore && media[0].id !== null && media[0].permalink !== null &&
    media[0].mediaType === "BROADCAST" && media[0].mediaProductType === "FEED" &&
    media[0].actualStartTime !== null && Date.parse(media[0].actualStartTime) <= Date.parse(observedAt) && media[0].usernameMatches;
  const state = media.length === 0 && !hasMore ? "offline" : validLive ? "live" : hasMore || media.length > 1 ? "ambiguous" : "unavailable";
  const matches = args[5] === "offline" ? state === "offline" : state === "live";
  console.log(JSON.stringify({ ...base, phase: "live_media", httpStatus: live.httpStatus, state, matches, media, hasMore }));
  return matches;
}

try { process.exitCode = await main() ? 0 : 1; }
catch { console.error("Instagram probe could not complete; verify private credentials and input format."); process.exitCode = 1; }
