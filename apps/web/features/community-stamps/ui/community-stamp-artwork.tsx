import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__community-stamps__ui__community-stamp-artwork";
import { translate } from "@/i18n/messages";
import Image from "next/image";
import { COMMUNITY_STAMPS, communityStampAsset, type CommunityStampKind } from "../domain/community-stamps";
export function CommunityStampArtwork({ kind, locale, size = 128, decorative = false, className }: { kind: CommunityStampKind; locale: AppLocale; size?: number; decorative?: boolean; className?: string }) {
  return <Image className={className} src={communityStampAsset(kind)} width={size} height={size} sizes={`${size}px`} alt={decorative ? "" : `${COMMUNITY_STAMPS[kind][locale]} ${locale === "ko" ? "스탬프" : translate(locale, localizedMessages.m8a61cccb79fa, "Stamp")}`} />;
}
