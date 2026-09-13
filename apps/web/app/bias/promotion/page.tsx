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
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return publicMetadata({
    path: "/bias/promotion",
    locale,
    title:
      locale === "en"
        ? "Promote your fan page | ByUs"
        : "팬페이지 홍보 안내 | ByUs",
    description:
      locale === "en"
        ? "Find your fan page and copy ready-to-use promotional messages."
        : "내 팬페이지 링크를 찾고 프로필, 스토리, 라이브용 홍보 문구를 복사하세요.",
  });
}
export default async function Page({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ko";
  let profiles: readonly PromotionProfile[] = [];
  let unavailable = false;
  try {
    profiles =
      await createPublishedContentRepositoryFromEnvironment().list(locale);
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
