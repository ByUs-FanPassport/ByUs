import { DEFAULT_SHARE_IMAGE, SITE_URL, NO_INDEX, isPrivatePath, isRehearsalPath } from "@/seo/metadata";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { LocaleProvider } from "../components/locale-provider";
import { DocumentLocale } from "../components/document-locale";
import { ByUsPrivyProvider } from "../components/privy-provider";
import { PwaRegistration } from "../components/pwa-registration";
import { readPublicPrivyTestAccountPolicy } from "../components/privy-test-account-policy";
import { readPublicPrivyAppleLoginPolicy } from "../components/privy-apple-login-policy";
import { AcquisitionSessionTracker } from "../features/analytics/client/acquisition-session-tracker";
import { VercelTelemetry } from "../features/analytics/client/vercel-telemetry";
import { FanNextActionGuide } from "../features/onboarding/ui/fan-next-action-guide";
import { BYUS_BRAND_ICONS } from "./brand-icons";
import { AuthTransitionBoundary } from "../components/auth-transition-boundary";
import { parseAppLocale, toContentLocale, type AppLocale } from "../i18n/locales";
import "./globals.css";

const DESCRIPTIONS: Record<AppLocale, string> = {
  ko: "최애의 라이브와 함께한 순간을 Fan Passport에 기록하세요.",
  en: "Record moments with each of your favorites in a Fan Passport.",
  ja: "推しのライブと過ごした瞬間をFan Passportに記録しましょう。",
  "zh-Hans": "将与喜爱的艺人一起度过的直播时刻记录在Fan Passport中。",
  "zh-Hant": "將與喜愛的藝人一起度過的直播時刻記錄在Fan Passport中。",
  es: "Guarda en Fan Passport los momentos que viviste en los directos de tus artistas favoritos.",
  id: "Catat momen saat menonton siaran langsung idola favoritmu di Fan Passport.",
  vi: "Lưu lại những khoảnh khắc xem trực tiếp cùng nghệ sĩ bạn yêu thích trong Fan Passport.",
  th: "บันทึกช่วงเวลาที่ได้ชมไลฟ์ของศิลปินคนโปรดไว้ใน Fan Passport",
  pt: "Registe no Fan Passport os momentos das transmissões dos seus artistas favoritos.",
  fr: "Enregistrez dans Fan Passport les moments vécus pendant les directs de vos artistes préférés.",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = parseAppLocale(requestHeaders.get("x-byus-locale"));
  return {
    metadataBase: new URL(SITE_URL),
    ...((isPrivatePath(requestHeaders.get("x-byus-pathname") ?? "") || isRehearsalPath(requestHeaders.get("x-byus-pathname") ?? "")) ? { robots: NO_INDEX } : {}),
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: {
        ...(process.env.NAVER_SITE_VERIFICATION ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } : {}),
        ...(process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : {}),
      },
    },
    title: "ByUs | Your Bias",
    description: DESCRIPTIONS[locale],
    manifest: `/manifest.webmanifest?locale=${locale}`,
    icons: BYUS_BRAND_ICONS,
    appleWebApp: { capable: true, title: "ByUs", statusBarStyle: "default" },
    openGraph: { locale: toContentLocale(locale) === "en" ? "en_US" : "ko_KR", siteName: "ByUs", type: "website", images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: "ByUs | Your Bias" }] },
    twitter: { card: "summary_large_image", images: [{ url: DEFAULT_SHARE_IMAGE, alt: "ByUs | Your Bias" }] },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = parseAppLocale(requestHeaders.get("x-byus-locale"));
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  const testAccountLoginEnabled = readPublicPrivyTestAccountPolicy();
  const appleLoginEnabled = readPublicPrivyAppleLoginPolicy();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
        <ByUsPrivyProvider
          appId={privyAppId}
          appleLoginEnabled={appleLoginEnabled}
          testAccountLoginEnabled={testAccountLoginEnabled}
        >
          <PwaRegistration />
          {process.env.VERCEL_ENV === "production" && <VercelTelemetry />}
          <Suspense fallback={null}>
            <AcquisitionSessionTracker />
          </Suspense>
          <Suspense fallback={null}>
            <DocumentLocale />
          </Suspense>
          <AuthTransitionBoundary modal={modal}>{children}</AuthTransitionBoundary>
          <Suspense fallback={null}><FanNextActionGuide /></Suspense>
        </ByUsPrivyProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
