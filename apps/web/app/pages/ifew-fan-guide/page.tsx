import { publicMetadata } from "@/seo/metadata";
import { loadGuideImages } from "@/server/media/guide-images";
import { resolvePhoto } from "@/features/media/domain/public-image";
export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { FanParticipationGuide } from "@/components/fan-participation-guide/fan-participation-guide";
import { ifewEventBanner, ifewFanGuideContent } from "@/components/ifew-fan-guide/content";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };
const resolveLocale = (locale?: string | string[]) => locale === "en" ? "en" : "ko";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = resolveLocale((await searchParams).locale);
  const images = await loadGuideImages(locale, "ifew");
  const content = ifewFanGuideContent[locale];
  const title = `${content.heroTitle.replace(/\n/g, " ")} | ByUs`;
  const description = `${content.heroDescription.replace(/\n/g, " ")} ${content.heroSchedule}`;
  return publicMetadata({ path: "/pages/ifew-fan-guide", locale, title, description, image: resolvePhoto(images.eventPhotos, "event.poster", ifewEventBanner, locale).src, imageAlt: content.eventImageAlt });
}

export default async function Page({ searchParams }: Props) {
  const locale = resolveLocale((await searchParams).locale);
  return <FanParticipationGuide locale={locale} creator="ifew" images={await loadGuideImages(locale, "ifew")} />;
}
