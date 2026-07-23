import { Suspense } from "react";
import { StampDetailOverlay } from "@/features/passport/ui/passport-screens";

export default async function StampDetailModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={null}><StampDetailOverlay id={id} /></Suspense>;
}
