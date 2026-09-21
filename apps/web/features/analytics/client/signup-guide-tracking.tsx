"use client";

import { type AppLocale, toContentLocale } from "@/i18n/locales";
import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import type { SignupAction, SignupGuide, SignupPlacement } from "../domain/signup-funnel-event";
import { signupFunnelTracker } from "./signup-funnel-tracker";

type GuideProps = { guide: SignupGuide; locale: AppLocale };

export function SignupGuideView({ guide, locale }: GuideProps) {
  const { ready, authenticated } = usePrivy();
  useEffect(() => {
    signupFunnelTracker.guideView(guide, toContentLocale(locale), ready ? authenticated ? "member" : "guest" : "unknown");
  }, [authenticated, guide, locale, ready]);
  return null;
}

export function SignupGuideLink({ guide, locale, action, placement, href, className, children }: GuideProps & {
  action: SignupAction; placement: SignupPlacement;
  href: Route | `#${string}` | `https://${string}`; className: string; children: ReactNode;
}) {
  const { ready, authenticated } = usePrivy();
  return <Link href={href} className={className} onClick={() => {
    signupFunnelTracker.guideCta(guide, toContentLocale(locale), ready ? authenticated ? "member" : "guest" : "unknown", action, placement);
  }}>{children}</Link>;
}
