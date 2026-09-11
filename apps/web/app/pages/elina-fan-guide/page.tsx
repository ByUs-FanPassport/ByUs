import { publicMetadata } from "@/seo/metadata";
import { loadGuideImages } from "@/server/media/guide-images";
import { resolvePhoto } from "@/features/media/domain/public-image";
export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { elinaFanGuideContent } from "@/components/elina-fan-guide/content";
import { ElinaFanGuidePage } from "@/components/elina-fan-guide/elina-fan-guide-page";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

function resolveLocale(locale?: string | string[]) {
  return locale === "en" ? "en" : "ko";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = resolveLocale((await searchParams).locale);
  const images = await loadGuideImages(locale, "elina");
  const content = elinaFanGuideContent[locale];
  const title = `${content.heroTitle.replace(/\n/g, " ")} | ByUs`;
  const description = content.heroDescription.replace(/\n/g, " ");
  return publicMetadata({ path: "/pages/elina-fan-guide", locale, title, description, image: images.celebrity ? resolvePhoto(images.celebrity.image.photos, "creator.hero.desktop", images.celebrity.image.url, locale).src : undefined, imageAlt: content.imageAlt });
}

export default async function Page({ searchParams }: Props) {
  const locale = resolveLocale((await searchParams).locale);
  return <ElinaFanGuidePage locale={locale} images={await loadGuideImages(locale, "elina")} />;
}
