import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__fan-shell__fan-wordmark-link";
import { translate } from "@/i18n/messages";
import Image from "next/image";
import type { Route } from "next";
import Link from "next/link";

type FanWordmarkLinkProps = {
  className?: string;
  href?: Route;
  locale?: AppLocale;
  ariaLabel?: string;
  priority?: boolean;
};

export function FanWordmarkLink({
  className,
  href,
  locale,
  ariaLabel,
  priority = true,
}: FanWordmarkLinkProps) {
  const resolvedHref = href ?? (locale ? `/?locale=${locale}` as Route : "/");
  const resolvedAriaLabel = ariaLabel ?? (!locale || locale === "ko" ? "ByUs 홈" : translate(locale ?? "en", localizedMessages.mae9332c916d9, "ByUs home"));

  return (
    <Link className={className} href={resolvedHref} aria-label={resolvedAriaLabel}>
      <Image
        src="/images/guest-home/byus-wordmark.svg"
        alt="ByUs"
        width={80}
        height={30}
        style={{ height: "auto" }}
        priority={priority}
      />
    </Link>
  );
}
