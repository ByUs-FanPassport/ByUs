import Image from "next/image";
import type { Route } from "next";
import Link from "next/link";

type FanWordmarkLinkProps = {
  className?: string;
  href?: Route;
  locale?: "ko" | "en";
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
  const resolvedAriaLabel = ariaLabel ?? (locale === "en" ? "ByUs home" : "ByUs 홈");

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
