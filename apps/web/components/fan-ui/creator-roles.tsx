"use client";

import {
  creatorRoleFilterLabel,
  creatorRoleLabel,
  type CreatorRole,
  type CreatorRoleFilter,
} from "@/features/creator/domain/creator-role";
import styles from "./creator-roles.module.css";

type Locale = "ko" | "en";

export function CreatorRoleFilterControl({ roles, value, onChange, locale, controls, ownedOnly = false, onSelectOwned, ownedDisabled = false }: {
  roles: readonly CreatorRole[];
  value: CreatorRoleFilter;
  onChange: (role: CreatorRoleFilter) => void;
  locale: Locale;
  controls?: string;
  ownedOnly?: boolean;
  onSelectOwned?: () => void;
  ownedDisabled?: boolean;
}) {
  return <div className={styles.filters} role="group" aria-label={locale === "ko" ? "직군으로 찾기" : "Browse by role"}>
    {onSelectOwned ? <button
      type="button"
      data-owned-filter="true"
      aria-pressed={Boolean(ownedOnly)}
      aria-controls={controls}
      disabled={ownedDisabled}
      onClick={onSelectOwned}
    >{locale === "ko" ? "내 최애" : "My favorites"}</button> : null}
    {(["all", ...roles] as const).map((role) => <button
      key={role}
      type="button"
      aria-pressed={!ownedOnly && value === role}
      aria-controls={controls}
      onClick={() => onChange(role)}
    >{creatorRoleFilterLabel(role, locale)}</button>)}
  </div>;
}

export function CreatorRolesText({ roles, locale }: { roles: readonly CreatorRole[]; locale: Locale }) {
  return <p className={styles.text} data-creator-roles={roles.join(",")}>
    {roles[0] ? creatorRoleLabel(roles[0], locale) : null}
  </p>;
}
