import type { NextConfig } from "next";
import { publicImageRemotePatterns } from "./components/fan-ui/public-image-policy";
import { responseSecurityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
        source: "/:path*",
        headers: responseSecurityHeaders,
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
