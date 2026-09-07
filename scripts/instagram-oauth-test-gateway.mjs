// Narrow, loopback-only gateway for an explicitly authorized temporary OAuth tunnel.
// Do not point a tunnel at the Next.js server itself. Disable tunnel request inspection.
import http from "node:http";
import { pathToFileURL } from "node:url";

const methods = new Map([
  ["/connect/instagram/start", new Set(["GET", "POST"])],
  ["/connect/instagram/callback", new Set(["GET"])],
  ["/connect/instagram/confirm", new Set(["GET", "POST"])],
  ["/connect/instagram/deletion-status", new Set(["GET"])],
  ["/api/instagram/deauthorize", new Set(["POST"])],
  ["/api/instagram/data-deletion", new Set(["POST"])],
]);
const responseHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

export function createInstagramTestGateway({ upstreamPort, publicOrigin }) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535) throw Error("Invalid local upstream port");
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== publicOrigin || origin.username || origin.password) throw Error("Use an exact HTTPS origin");
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/privacy" && request.method === "GET") {
      response.writeHead(302, { ...responseHeaders, location: "https://byus.kr/privacy" }); response.end(); return;
    }
    if (!methods.get(url.pathname)?.has(request.method)) {
      response.writeHead(404, responseHeaders); response.end(); return;
    }
    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 16384) { response.writeHead(413, responseHeaders); response.end(); return; }
        chunks.push(chunk);
      }
    } catch { response.writeHead(400, responseHeaders); response.end(); return; }
    // Only flow-relevant headers cross this gateway. In particular, no admin bearer
    // token, arbitrary proxy credentials, upgrade, debug, or forwarding headers.
    const headers = { host: origin.host, "x-forwarded-proto": "https", "x-forwarded-host": origin.host };
    for (const header of ["cookie", "origin", "content-type", "accept"]) if (request.headers[header]) headers[header] = request.headers[header];
    const body = Buffer.concat(chunks);
    if (body.length) headers["content-length"] = String(body.length);
    const upstream = http.request({ hostname: "127.0.0.1", port: upstreamPort, method: request.method, path: url.pathname + url.search, headers }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, ...responseHeaders });
      incoming.pipe(response);
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, responseHeaders); response.end(); });
    upstream.end(body);
    // Never log URLs, cookies, bodies, OAuth codes, signed requests, or credentials.
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createInstagramTestGateway({ upstreamPort: Number(process.env.INSTAGRAM_TEST_UPSTREAM_PORT ?? "4319"), publicOrigin: process.env.INSTAGRAM_TEST_PUBLIC_ORIGIN });
  const port = Number(process.env.INSTAGRAM_TEST_GATEWAY_PORT ?? "4320");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid gateway port");
  server.listen(port, "127.0.0.1", () => console.log(`Instagram OAuth gateway listening on loopback port ${port}; unrelated routes blocked`));
}
