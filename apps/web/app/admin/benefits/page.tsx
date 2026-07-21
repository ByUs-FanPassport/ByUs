import { Suspense } from "react";
import { AuthorizedBenefitManager } from "../../../components/admin/benefit-manager";
export default function AdminBenefitsPage(){return <Suspense fallback={null}><AuthorizedBenefitManager/></Suspense>}
