"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function ByUsPrivyProvider({ appId, children }: { appId: string; children: ReactNode }) {
  if (!appId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is required to initialize ByUs authentication.");
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google"],
        appearance: {
          theme: "light",
          accentColor: "#8A18B8",
          logo: "/images/guest-home/byus-wordmark.svg",
          landingHeader: "ByUs 시작하기",
          loginMessage: "Google 계정으로 로그인하고 최애와 함께한 순간을 기록하세요.",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
