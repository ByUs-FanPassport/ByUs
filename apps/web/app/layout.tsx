import type { Metadata, Viewport } from "next";
import { ByUsPrivyProvider } from "../components/privy-provider";
import { PwaRegistration } from "../components/pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "ByUs | Your Bias",
  description: "최애의 라이브와 함께한 순간을 Fan Passport에 기록하세요.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ByUs", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  return (
    <html lang="ko">
      <body>
        <ByUsPrivyProvider appId={privyAppId}>
          <PwaRegistration />
          {children}
        </ByUsPrivyProvider>
      </body>
    </html>
  );
}
