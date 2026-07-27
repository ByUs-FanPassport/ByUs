import { Suspense } from "react";
import { StampDetailScreen } from "../../../features/passport/ui/passport-screens";
import { loadServerEnv } from "../../../server/config/env";

export default async function StampPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const environment = loadServerEnv();
  return <Suspense><StampDetailScreen id={id} explorerBaseUrl={environment.GIWA_EXPLORER_URL} /></Suspense>;
}
