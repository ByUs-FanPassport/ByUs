export const SETTINGS_SECTIONS = [
  "profile",
  "language",
  "notifications",
  "channels",
  "account",
  "installation",
  "blocked",
  "delete",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  return SETTINGS_SECTIONS.includes(value as SettingsSection) ? value as SettingsSection : null;
}
