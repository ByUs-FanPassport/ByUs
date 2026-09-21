"use client";

import { messages as localizedMessages } from "@/i18n/catalogs/components__privy-provider";
import { translate } from "@/i18n/messages";
import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { useAppLocale } from "./locale-provider";
import { AvatarSessionBridge } from "./avatar-session-bridge";
import { ByUsSessionProvider } from "./byus-session-provider";

export function ByUsPrivyProvider({
  appId,
  appleLoginEnabled = false,
  testAccountLoginEnabled = false,
  children,
}: {
  appId: string;
  appleLoginEnabled?: boolean;
  testAccountLoginEnabled?: boolean;
  children: ReactNode;
}) {
  const { locale } = useAppLocale();
  if (!appId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is required to initialize ByUs authentication.");
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Let the OAuth provider decide whether the current embedded browser is supported.
        allowOAuthInEmbeddedBrowsers: true,
        loginMethods: [
          "google",
          ...(appleLoginEnabled ? (["apple"] as const) : []),
          ...(testAccountLoginEnabled ? (["email"] as const) : []),
        ],
        appearance: {
          theme: "light",
          accentColor: "#8A18B8",
          logo: "/images/guest-home/byus-wordmark.svg",
          landingHeader: locale === "ko" ? "ByUs 시작하기" : translate(locale, localizedMessages.mec65a0eab4d9, "Get started with ByUs"),
          loginMessage: testAccountLoginEnabled
            ? appleLoginEnabled
              ? locale === "ko" ? "Google, Apple 또는 Privy Test Account 이메일로 로그인하세요." : translate(locale, localizedMessages.m9bbd915ffa25, "Sign in with Google, Apple or your Privy Test Account email.")
              : locale === "ko" ? "Google 계정 또는 Privy Test Account 이메일로 로그인하세요." : translate(locale, localizedMessages.m842d64f75fa5, "Sign in with Google or your Privy Test Account email.")
            : appleLoginEnabled
              ? locale === "ko" ? "Google 또는 Apple 계정으로 로그인하고 최애와 함께한 순간을 기록하세요." : translate(locale, localizedMessages.mfad7525856e8, "Sign in with Google or Apple to keep a record of moments with your favorites.")
              : locale === "ko" ? "Google 계정으로 로그인하고 최애와 함께한 순간을 기록하세요." : translate(locale, localizedMessages.mfaf03be529aa, "Sign in with Google to keep a record of moments with your favorites."),
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
        },
      }}
    >
      <AvatarSessionBridge><ByUsSessionProvider>{children}</ByUsSessionProvider></AvatarSessionBridge>
    </PrivyProvider>
  );
}
