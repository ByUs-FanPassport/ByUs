import { Suspense } from "react";
import { AdminDirectoryManager } from "../../../components/admin/admin-directory-manager";

export default function AdministratorsPage() {
  return <Suspense fallback={null}><AdminDirectoryManager /></Suspense>;
}
