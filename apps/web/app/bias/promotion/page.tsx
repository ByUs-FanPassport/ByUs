import { toContentLocale } from "@/i18n/locales";
import { parseAppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/app__bias__promotion__page";
import { translate } from "@/i18n/messages";
import type { PromotionProfile } from "@/features/bias/domain/promotion";
import { PromotionPage } from "@/features/bias/ui/promotion-page";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { publicMetadata } from "@/seo/metadata";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale?: string; celebrity?: string }>;
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Params;
}) {
  const locale = parseAppLocale((await searchParams).locale);
  return publicMetadata({
    path: "/bias/promotion",
    locale,
    title:
      locale === "ko" ? "팬페이지 홍보 안내 | ByUs" : translate(locale, localizedMessages.mabdee7400079, "Promote your fan page | ByUs"),
    description:
      locale === "ko" ? "내 팬페이지 링크를 찾고 프로필, 스토리, 라이브용 홍보 문구를 복사하세요." : translate(locale, localizedMessages.mac2697327da4, "Find your fan page and copy ready-to-use promotional messages."),
  });
}
export default async function Page({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const locale = parseAppLocale(params.locale);
  let profiles: readonly PromotionProfile[] = [];
  let unavailable = false;
  try {
    profiles =
      await createPublishedContentRepositoryFromEnvironment().list(toContentLocale(locale));
  } catch {
    unavailable = true;
  }
  return (
    <PromotionPage
      profiles={profiles}
      locale={locale}
      initialSlug={params.celebrity}
      unavailable={unavailable}
    />
  );
}
