import { parseAppLocale } from "@/i18n/locales";
import { MyRafflesScreen } from "@/features/benefit/ui/my-raffles-screen";

export default async function MyRafflesPage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const locale = parseAppLocale((await searchParams).locale);
  return <MyRafflesScreen locale={locale} />;
}
