import type { NextConfig } from "next";
import { publicImageRemotePatterns } from "./components/fan-ui/public-image-policy";
import { responseSecurityHeaders } from "./security-headers";
import { htmlLimitedBots } from "./seo/bots";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  htmlLimitedBots,
  images: { remotePatterns: publicImageRemotePatterns },
  poweredByHeader: false,
  typedRoutes: true,
  // Sharp 0.35 moved its entry point; Next 16's native dependency tracing
  // misses libvips. Include the installed runtime assets for avatar routes.
  outputFileTracingIncludes: {
    "/api/me/avatar": ["../../node_modules/@img/sharp-libvips-*/**/*"],
    "/api/me/avatar/**": ["../../node_modules/@img/sharp-libvips-*/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path((?!connect/instagram/).*)",
        headers: responseSecurityHeaders,
      },
      {
        // OAuth flow documents supply their own hashed-style, script-free CSP.
        // A second global form-action 'self' would block their external 303.
        source: "/connect/instagram/:path*",
        headers: [
          ...responseSecurityHeaders.filter((header) => !["Content-Security-Policy", "Referrer-Policy"].includes(header.key)),
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.instagram.com; base-uri 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/live/elina-nualeaf-live/:path*",
        destination: "/live/elina-byus-live/:path*",
        permanent: true,
      },
      {
        source: "/live/changha-nualeaf-live/:path*",
        destination: "/live/changha-byus-live/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
