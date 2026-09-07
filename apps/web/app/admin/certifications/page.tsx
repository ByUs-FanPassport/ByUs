import { Suspense } from "react";
import { AuthorizedCertificationManager } from "@/components/admin/certification-manager";
export default function AdminCertificationsPage(){return <Suspense fallback={null}><AuthorizedCertificationManager/></Suspense>}
