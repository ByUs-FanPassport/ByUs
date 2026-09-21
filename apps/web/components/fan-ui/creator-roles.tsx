"use client";

import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__fan-ui__creator-roles";
import { translate } from "@/i18n/messages";
import {
  creatorRoleFilterLabel,
  creatorRoleLabel,
  type CreatorRole,
  type CreatorRoleFilter,
} from "@/features/creator/domain/creator-role";
import styles from "./creator-roles.module.css";

type Locale = AppLocale;

export function CreatorRoleFilterControl({ roles, value, onChange, locale, controls, ownedOnly = false, onSelectOwned, ownedDisabled = false, compact = false }: {
  roles: readonly CreatorRole[];
  value: CreatorRoleFilter;
  onChange: (role: CreatorRoleFilter) => void;
  locale: Locale;
  controls?: string;
  ownedOnly?: boolean;
  onSelectOwned?: () => void;
  ownedDisabled?: boolean;
  compact?: boolean;
}) {
  return <div className={styles.filters} data-compact={compact || undefined} role="group" aria-label={locale === "ko" ? "직군으로 찾기" : translate(locale, localizedMessages.m61fa7982f0ed, "Browse by role")}>
    {onSelectOwned ? <button
      type="button"
      data-owned-filter="true"
      aria-pressed={Boolean(ownedOnly)}
      aria-controls={controls}
      disabled={ownedDisabled}
      onClick={onSelectOwned}
    ><span>{locale === "ko" ? "내 최애" : translate(locale, localizedMessages.mc53f55277fa2, "My favorites")}</span></button> : null}
    {(["all", ...roles] as const).map((role) => <button
      key={role}
      type="button"
      aria-pressed={!ownedOnly && value === role}
      aria-controls={controls}
      onClick={() => onChange(role)}
    ><span>{creatorRoleFilterLabel(role, locale)}</span></button>)}
  </div>;
}

export function CreatorRolesText({ roles, locale }: { roles: readonly CreatorRole[]; locale: Locale }) {
  return <p className={styles.text} data-creator-roles={roles.join(",")}>
    {roles[0] ? creatorRoleLabel(roles[0], locale) : null}
  </p>;
}
