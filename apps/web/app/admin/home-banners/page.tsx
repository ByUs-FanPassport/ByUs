import { Suspense } from "react";
import { AuthorizedHomeBannerManager } from "../../../components/admin/home-banner-manager";

export default function AdminHomeBannersPage() {
  return <Suspense fallback={null}><AuthorizedHomeBannerManager /></Suspense>;
}
