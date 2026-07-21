import { Suspense } from "react";
import { StampDetailScreen } from "../../../features/passport/ui/passport-screens";

export default async function StampPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense><StampDetailScreen id={id} /></Suspense>; }
