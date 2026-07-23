import type { NextConfig } from "next";
import { responseSecurityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
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
