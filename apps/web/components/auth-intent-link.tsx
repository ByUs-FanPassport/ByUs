"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import {
  buildAuthLoginHref,
  createAuthIntent,
  legacyIntentForAction,
  persistAuthIntent,
  type CreateAuthIntentInput,
} from "./auth-intent";
import { rememberOverlayTrigger } from "./ui/overlay/focus-return";

function fallbackHref(input: CreateAuthIntentInput, locale: "ko" | "en"): string {
  const returnTo = `${input.sourcePath}${input.sourceQuery}${input.returnAnchor ?? ""}`;
  const query = new URLSearchParams({
    returnTo,
    locale,
    intent: legacyIntentForAction(input.actionType),
    entity: input.targetId,
  });
  return `/login?${query.toString()}`;
}

export function AuthIntentLink({
  input,
  locale,
  className,
  children,
  ariaLabel,
  focusKey,
}: {
  input: CreateAuthIntentInput;
  locale: "ko" | "en";
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  focusKey?: string;
}) {
  const router = useRouter();
  const href = fallbackHref(input, locale);

  function begin(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const intent = createAuthIntent(input);
    persistAuthIntent(window.sessionStorage, intent);
    rememberOverlayTrigger(
      event.currentTarget,
      focusKey ? `[data-overlay-focus-key="${focusKey}"]` : undefined,
    );
    event.preventDefault();
    router.push(buildAuthLoginHref(intent, locale) as Route);
  }

  return <a className={className} href={href} aria-label={ariaLabel} data-overlay-focus-key={focusKey} onClick={begin}>{children}</a>;
}
