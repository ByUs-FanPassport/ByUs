import Image from "next/image";
import { COMMUNITY_STAMPS, communityStampAsset, type CommunityStampKind } from "../domain/community-stamps";
export function CommunityStampArtwork({ kind, locale, size = 128, decorative = false, className }: { kind: CommunityStampKind; locale: "ko" | "en"; size?: number; decorative?: boolean; className?: string }) {
  return <Image className={className} src={communityStampAsset(kind)} width={size} height={size} sizes={`${size}px`} alt={decorative ? "" : `${COMMUNITY_STAMPS[kind][locale]} ${locale === "ko" ? "스탬프" : "Stamp"}`} />;
}
