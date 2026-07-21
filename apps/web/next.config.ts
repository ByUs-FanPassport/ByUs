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
};

export default nextConfig;
