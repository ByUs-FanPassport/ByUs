import { parseAppLocale } from "@/i18n/locales";
import { parseSettingsSection } from "../../features/profile/domain/settings-navigation";
import { SettingsScreen } from "../../features/profile/ui/settings-screen";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; section?: string }>;
}) {
  const { locale, section } = await searchParams;
  return <SettingsScreen locale={parseAppLocale(locale)} initialSection={parseSettingsSection(section)} />;
}
