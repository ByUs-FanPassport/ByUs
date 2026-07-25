import type { ReactNode } from "react";
import type { Route } from "next";

import { FanWordmarkLink } from "./fan-wordmark-link";
import { FanContentContainer } from "./fan-content-container";

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
      <FanContentContainer className={innerClassName}>
        <FanWordmarkLink
          ariaLabel={brandAriaLabel}
          className={brandClassName}
          href={brandHref}
        />
        {children}
      </FanContentContainer>
    </header>
  );
}
