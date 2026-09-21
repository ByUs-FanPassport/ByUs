"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__fan-ui__creator-fan-link";
import { translate } from "@/i18n/messages";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { Heart } from "../icons";
import { mySummarySchema } from "../../features/my/domain/my-summary";
import { useOwnedFanResource } from "./use-owned-fan-resource";
import { useOptionalHomeCreatorVerification } from "./home-owner-provider";
import styles from "../guest-home.module.css";

function parseVerifiedCreators(value: unknown): ReadonlySet<string> {
  const summary = mySummarySchema.parse((value as { summary?: unknown })?.summary);
  return new Set(summary.creators.filter((creator) => creator.passport).map((creator) => creator.celebrity.slug));
}

type FanLinkState = { status: "guest" | "loading" | "error" | "ready"; verified?: boolean };

function LinkView({ slug, name, locale, state }: { slug: string; name: string; locale: AppLocale; state: FanLinkState }) {
  const verified = state.status === "ready" && state.verified === true;
  const checking = state.status === "loading";
  const unavailable = state.status === "error";
  const label = checking ? (locale === "ko" ? "확인 중" : translate(locale, localizedMessages.m3ef156cad29a, "Checking"))
    : verified ? (locale === "ko" ? "입덕 완료" : translate(locale, localizedMessages.m9f6b28aeb90d, "Fan verified"))
    : unavailable ? (locale === "ko" ? "팬페이지 보기" : translate(locale, localizedMessages.m3c982b122f61, "View fan page"))
    : (locale === "ko" ? "입덕하기" : translate(locale, localizedMessages.m8ea67bd69d6f, "Become a fan"));
  return <Link className={styles.celebrityFanLink} data-verified={verified || undefined}
    href={`${creatorHomeHref(slug)}?locale=${locale}` as Route} aria-label={`${name} ${label}`} aria-busy={checking || undefined}>
    <Heart aria-hidden="true" /><span>{label}</span>
  </Link>;
}

function StandaloneCreatorFanLink({ slug, name, locale }: { slug: string; name: string; locale: AppLocale }) {
  const auth = usePrivy();
  const { state } = useOwnedFanResource(`/api/me/summary?locale=${toContentLocale(locale)}&tierStages=1`, parseVerifiedCreators, auth);
  const viewState: FanLinkState = !auth.ready || (auth.authenticated && state.status === "loading") ? { status: "loading" }
    : !auth.authenticated ? { status: "guest" }
    : state.status === "error" ? { status: "error" }
    : state.status === "ready" ? { status: "ready", verified: state.data.has(slug) }
    : { status: "loading" };
  return <LinkView slug={slug} name={name} locale={locale} state={viewState} />;
}

export function CreatorFanLink(props: { slug: string; name: string; locale: AppLocale }) {
  const homeState = useOptionalHomeCreatorVerification(props.slug);
  return homeState ? <LinkView {...props} state={homeState} /> : <StandaloneCreatorFanLink {...props} />;
}
