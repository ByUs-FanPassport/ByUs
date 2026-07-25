import { Suspense } from "react";
import { StampDetailOverlay } from "@/features/passport/ui/passport-screens";
import { FanRouteLoading } from "@/components/fan-ui/fan-route-loading";

export default async function StampDetailModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<FanRouteLoading presentation="overlay" />}>
      <StampDetailOverlay id={id} />
    </Suspense>
  );
}
