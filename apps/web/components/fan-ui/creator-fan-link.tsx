"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { Heart } from "../icons";
import { reactionResultSchema } from "../../features/reaction/domain/reaction";
import { useOwnedFanResource } from "./use-owned-fan-resource";
import styles from "../guest-home.module.css";

function parseReaction(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("reaction" in value)) throw new Error("Invalid reaction response");
  return value.reaction === null ? false : Boolean(reactionResultSchema.parse(value.reaction));
}

export function CreatorFanLink({ slug, name, locale }: { slug: string; name: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  const { state } = useOwnedFanResource(`/api/celebrities/${encodeURIComponent(slug)}/reactions`, parseReaction, auth);
  const recorded = state.status === "ready" && state.data;
  const checking = !auth.ready || (auth.authenticated && state.status === "loading");
  const unavailable = auth.authenticated && state.status === "error";
  const label = checking ? (locale === "ko" ? "확인 중" : "Checking")
    : recorded ? (locale === "ko" ? "입덕 완료" : "Reaction recorded")
    : unavailable ? (locale === "ko" ? "팬페이지 보기" : "View fan page")
    : (locale === "ko" ? "입덕하기" : "Become a fan");
  return <Link className={styles.celebrityFanLink} data-reacted={recorded || undefined}
    href={`/c/${slug}?locale=${locale}` as Route} aria-label={`${name} ${label}`} aria-busy={checking || undefined}>
    <Heart aria-hidden="true" /><span>{label}</span>
  </Link>;
}
