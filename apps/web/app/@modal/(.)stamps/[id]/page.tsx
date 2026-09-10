import { Suspense } from "react";
import { StampDetailOverlay } from "@/features/passport/ui/passport-screens";
import { FanRouteLoading } from "@/components/fan-ui/fan-route-loading";
import { loadServerEnv } from "@/server/config/env";

export default async function StampDetailModalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const environment = loadServerEnv();
  return (
    <Suspense fallback={<FanRouteLoading locale={locale} presentation="overlay" />}>
      <StampDetailOverlay id={id} explorerBaseUrl={environment.GIWA_EXPLORER_URL} />
    </Suspense>
  );
}
