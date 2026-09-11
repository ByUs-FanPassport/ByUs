import { notFound } from "next/navigation";
import { LiveEventScreen } from "@/features/live/ui/live-event-screen";
import { loadSeoLive } from "@/server/seo/public-content";
import { publicMetadata } from "@/seo/metadata";
import { resolvePhoto } from "@/features/media/domain/public-image";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const data = await loadSeoLive(slug, locale);
  if (!data) notFound();
  const translated = await loadSeoLive(slug, locale === "en" ? "ko" : "en");
  const { live } = data;
  const photo = resolvePhoto(live.photos, "event.detail", live.heroImage.url, locale);
  const schedule = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: locale === "en",
  }).format(new Date(live.startsAt));
  return publicMetadata({ path: `/live/${slug}`, locale, title: `${live.title} | ByUs`,
    description: `${live.celebrity.name} · ${schedule} KST · ${live.watch.provider}. ${live.description}`,
    image: photo.src, imageAlt: photo.alt ?? live.heroImage.alt,
    locales: translated ? ["ko", "en"] : [locale] });
}

export default async function LiveEventPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const data = await loadSeoLive(slug, locale);
  if (!data) notFound();
  return <LiveEventScreen key={`${slug}:${locale}`} slug={slug} locale={locale} initialData={data} />;
}
