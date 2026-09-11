"use client";

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { usePathname } from "next/navigation";
import { isPublicTelemetryPath, sanitizeVercelTelemetry } from "./vercel-telemetry-policy";

export function VercelTelemetry() {
  const pathname = usePathname();
  if (!pathname || !isPublicTelemetryPath(pathname)) return null;

  // Scripts outlive SPA unmounts: the stable callback must also reject private URLs.
  // Explicit pathname tracking keeps query strings out of the SDK's pageview queue.
  return <>
    <Analytics
      framework="next"
      mode="production"
      debug={false}
      route={pathname}
      path={pathname}
      scriptSrc="/_vercel/insights/script.js"
      endpoint="/_vercel/insights"
      beforeSend={sanitizeVercelTelemetry}
    />
    <SpeedInsights
      framework="next"
      debug={false}
      route={pathname}
      scriptSrc="/_vercel/speed-insights/script.js"
      endpoint="/_vercel/speed-insights/vitals"
      beforeSend={sanitizeVercelTelemetry}
    />
  </>;
}
