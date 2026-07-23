import Image from "next/image";
import type { Route } from "next";
import Link from "next/link";

type FanWordmarkLinkProps = {
  className?: string;
  href?: Route;
  ariaLabel?: string;
  priority?: boolean;
};

export function FanWordmarkLink({
  className,
  href = "/",
  ariaLabel = "ByUs 홈",
  priority = true,
}: FanWordmarkLinkProps) {
  return (
    <Link className={className} href={href} aria-label={ariaLabel}>
      <Image
        src="/images/guest-home/byus-wordmark.svg"
        alt="ByUs"
        width={80}
        height={30}
        priority={priority}
      />
    </Link>
  );
}
