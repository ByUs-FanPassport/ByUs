"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import type { SignupAction, SignupGuide, SignupPlacement } from "../domain/signup-funnel-event";
import { signupFunnelTracker } from "./signup-funnel-tracker";

type GuideProps = { guide: SignupGuide; locale: "ko" | "en" };

export function SignupGuideView({ guide, locale }: GuideProps) {
  const { ready, authenticated } = usePrivy();
  useEffect(() => {
    signupFunnelTracker.guideView(guide, locale, ready ? authenticated ? "member" : "guest" : "unknown");
  }, [authenticated, guide, locale, ready]);
  return null;
}

export function SignupGuideLink({ guide, locale, action, placement, href, className, children }: GuideProps & {
  action: SignupAction; placement: SignupPlacement;
  href: Route | `#${string}` | `https://${string}`; className: string; children: ReactNode;
}) {
  const { ready, authenticated } = usePrivy();
  return <Link href={href} className={className} onClick={() => {
    signupFunnelTracker.guideCta(guide, locale, ready ? authenticated ? "member" : "guest" : "unknown", action, placement);
  }}>{children}</Link>;
}
