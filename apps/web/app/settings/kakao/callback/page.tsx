import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { KakaoCallbackScreen } from "@/features/notification/ui/kakao-callback-screen";

export const metadata: Metadata = {
  title: "Kakao connection | ByUs",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function KakaoCallbackPage() {
  const locale = (await cookies()).get("byus_locale")?.value === "en" ? "en" : "ko";
  return <Suspense fallback={null}><KakaoCallbackScreen locale={locale} /></Suspense>;
}
