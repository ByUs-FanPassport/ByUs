import { parseAppLocale } from "@/i18n/locales";
import { MyScreen } from "@/features/my/ui/my-screen";

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const locale = parseAppLocale((await searchParams).locale);
  return <MyScreen locale={locale} />;
}
