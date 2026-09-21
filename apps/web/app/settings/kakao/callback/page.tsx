import { parseAppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/app__settings__kakao__callback__page";
import { translate } from "@/i18n/messages";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { KakaoCallbackScreen } from "@/features/notification/ui/kakao-callback-screen";

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseAppLocale((await headers()).get("x-byus-locale"));
  return {
    title: locale === "ko" ? "카카오 연결 | ByUs" : translate(locale, localizedMessages.m7a17fb5bbdee, "Kakao connection | ByUs"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function KakaoCallbackPage() {
  const locale = parseAppLocale((await headers()).get("x-byus-locale"));
  return <Suspense fallback={null}><KakaoCallbackScreen locale={locale} /></Suspense>;
}
