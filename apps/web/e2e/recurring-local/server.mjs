import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
export async function startHarness({ port = 4194 } = {}) {
  const server = await createServer({
    configFile: false, esbuild: { jsx: "automatic" }, root: here, publicDir: path.join(web, "public"),
    cacheDir: path.join(web, "node_modules/.vite-recurring-local"),
    resolve: { alias: [
      { find: "@", replacement: web },
      ...["next/link", "next/image", "next/navigation", "server-only"].map(name => ({ find: name, replacement: path.join(web, "e2e/mission-local", { "next/link": "next-link.tsx", "next/image": "next-image.tsx", "next/navigation": "next-navigation.ts", "server-only": "server-only.ts" }[name]) })),
      { find: "@privy-io/react-auth", replacement: path.join(here, "privy.ts") },
    ] },
    server: { host: "127.0.0.1", port, strictPort: true, fs: { allow: [web, path.resolve(web, "../../node_modules")] } },
    define: { "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify(`http://localhost:${port}`) },
  });
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.startsWith("/api/public/live-now") ? { items: [], targets: [], checkedAt: new Date().toISOString() } : { states: {} }));
  });
  await server.listen();
  return { baseURL: `http://127.0.0.1:${port}`, close: () => server.close() };
}
