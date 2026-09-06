"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { AvatarSessionBridge } from "./avatar-session-bridge";

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
  if (!appId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is required to initialize ByUs authentication.");
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: [
          "google",
          ...(appleLoginEnabled ? (["apple"] as const) : []),
          ...(testAccountLoginEnabled ? (["email"] as const) : []),
        ],
        appearance: {
          theme: "light",
          accentColor: "#8A18B8",
          logo: "/images/guest-home/byus-wordmark.svg",
          landingHeader: "ByUs 시작하기",
          loginMessage: testAccountLoginEnabled && appleLoginEnabled
            ? "Google, Apple 또는 Privy Test Account 이메일로 로그인하세요."
            : testAccountLoginEnabled
              ? "Google 계정 또는 Privy Test Account 이메일로 로그인하세요."
            : appleLoginEnabled
              ? "Google 또는 Apple 계정으로 로그인하고 최애와 함께한 순간을 기록하세요."
              : "Google 계정으로 로그인하고 최애와 함께한 순간을 기록하세요.",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
        },
      }}
    >
      <AvatarSessionBridge>{children}</AvatarSessionBridge>
    </PrivyProvider>
  );
}
