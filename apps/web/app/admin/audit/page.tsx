import { Suspense } from "react";
import { AuditLogManager } from "../../../components/admin/audit-log-manager";

export default function AuditPage() { return <Suspense fallback={null}><AuditLogManager /></Suspense>; }

