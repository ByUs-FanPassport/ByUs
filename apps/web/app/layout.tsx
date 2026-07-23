import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { DocumentLocale } from "../components/document-locale";
import { ByUsPrivyProvider } from "../components/privy-provider";
import { PwaRegistration } from "../components/pwa-registration";
import { readPublicPrivyTestAccountPolicy } from "../components/privy-test-account-policy";
import {
  isLocalProductionData,
  ProductionDataIndicator,
} from "../components/production-data-indicator";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = requestHeaders.get("x-byus-locale") === "en" ? "en" : "ko";
  return {
    title: "ByUs | Your Bias",
    description:
      locale === "en"
        ? "Keep every moment with your favorite in your Fan Passport."
        : "최애의 라이브와 함께한 순간을 Fan Passport에 기록하세요.",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "ByUs", statusBarStyle: "default" },
    openGraph: { locale: locale === "en" ? "en_US" : "ko_KR" },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal?: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = requestHeaders.get("x-byus-locale") === "en" ? "en" : "ko";
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  const testAccountLoginEnabled = readPublicPrivyTestAccountPolicy();
  const showProductionDataIndicator = isLocalProductionData(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT,
  );
  return (
    <html lang={locale}>
      <body>
        <ByUsPrivyProvider
          appId={privyAppId}
          testAccountLoginEnabled={testAccountLoginEnabled}
        >
          <PwaRegistration />
          <Suspense fallback={null}>
            <DocumentLocale />
          </Suspense>
          <ProductionDataIndicator visible={showProductionDataIndicator} />
          {children}
          {modal}
        </ByUsPrivyProvider>
      </body>
    </html>
  );
}
