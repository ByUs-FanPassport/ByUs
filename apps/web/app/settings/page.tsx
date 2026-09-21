import { parseAppLocale } from "@/i18n/locales";
import { SettingsScreen } from "../../features/profile/ui/settings-screen";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { locale } = await searchParams;
  return <SettingsScreen locale={parseAppLocale(locale)} />;
}
