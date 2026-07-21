import { Suspense } from "react";
import { PassportDetailScreen } from "../../../features/passport/ui/passport-screens";

export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense><PassportDetailScreen id={id} /></Suspense>; }
