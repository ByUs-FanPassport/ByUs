import type { ReactNode } from "react";
import type { Route } from "next";

import { FanWordmarkLink } from "./fan-wordmark-link";

type FanHeaderProps = {
  brandAriaLabel?: string;
  brandClassName?: string;
  brandHref?: Route;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
};

export function FanHeader({
  brandAriaLabel,
  brandClassName,
  brandHref,
  children,
  className,
  innerClassName,
}: FanHeaderProps) {
  return (
    <header className={className}>
      <div className={innerClassName}>
        <FanWordmarkLink
          ariaLabel={brandAriaLabel}
          className={brandClassName}
          href={brandHref}
        />
        {children}
      </div>
    </header>
  );
}
