"use client";

import {
  creatorRoleFilterLabel,
  creatorRoleLabel,
  type CreatorRole,
  type CreatorRoleFilter,
} from "@/features/creator/domain/creator-role";
import styles from "./creator-roles.module.css";

type Locale = "ko" | "en";

export function CreatorRoleFilterControl({ roles, value, onChange, locale, controls }: {
  roles: readonly CreatorRole[];
  value: CreatorRoleFilter;
  onChange: (role: CreatorRoleFilter) => void;
  locale: Locale;
  controls?: string;
}) {
  return <div className={styles.filters} role="group" aria-label={locale === "ko" ? "직군으로 찾기" : "Browse by role"}>
    {(["all", ...roles] as const).map((role) => <button
      key={role}
      type="button"
      aria-pressed={value === role}
      aria-controls={controls}
      onClick={() => onChange(role)}
    >{creatorRoleFilterLabel(role, locale)}</button>)}
  </div>;
}

export function CreatorRolesText({ roles, locale }: { roles: readonly CreatorRole[]; locale: Locale }) {
  const fullText = roles.map((role) => creatorRoleLabel(role, locale)).join(" · ");
  return <p className={styles.text} data-creator-roles={roles.join(",")}>
    <span aria-hidden="true">{roles.slice(0, 2).map((role) => creatorRoleLabel(role, locale)).join(" · ")}</span>
    <span className={styles.srOnly}>{fullText}</span>
  </p>;
}
