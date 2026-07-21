import { Suspense } from "react";
import { BlockchainJobsManager } from "../../../components/admin/blockchain-jobs-manager";

export default function BlockchainJobsPage() { return <Suspense fallback={null}><BlockchainJobsManager /></Suspense>; }

