import { parseAppLocale } from "@/i18n/locales";
import { historyKindSchema } from "@/features/my/domain/fan-history";
import { FanHistoryScreen } from "@/features/my/ui/fan-history-screen";
export default async function FanHistoryPage({ searchParams }: { searchParams: Promise<{ locale?: string; kind?: string }> }) {
  const params = await searchParams;
  return <FanHistoryScreen locale={parseAppLocale(params.locale)} kind={historyKindSchema.catch("applications").parse(params.kind)} />;
}
