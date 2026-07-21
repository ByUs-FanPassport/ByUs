import type { Metadata } from "next";
import { ByUsPrivyProvider } from "../components/privy-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ByUs | Your Bias",
  description: "최애의 라이브와 함께한 순간을 Fan Passport에 기록하세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  return (
    <html lang="ko">
      <body><ByUsPrivyProvider appId={privyAppId}>{children}</ByUsPrivyProvider></body>
    </html>
  );
}
