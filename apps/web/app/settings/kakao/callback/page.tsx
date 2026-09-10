import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { KakaoCallbackScreen } from "@/features/notification/ui/kakao-callback-screen";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await headers()).get("x-byus-locale");
  return {
    title: locale === "en" ? "Kakao connection | ByUs" : "카카오 연결 | ByUs",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function KakaoCallbackPage() {
  const locale = (await headers()).get("x-byus-locale") === "en" ? "en" : "ko";
  return <Suspense fallback={null}><KakaoCallbackScreen locale={locale} /></Suspense>;
}
