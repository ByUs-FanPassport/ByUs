import { Suspense } from "react";
import { AuthorizedLiveManager } from "../../../components/admin/live-manager";
export default function AdminLivesPage() { return <Suspense fallback={null}><AuthorizedLiveManager /></Suspense>; }
