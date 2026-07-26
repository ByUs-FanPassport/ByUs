"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import {
  authIntentReturnTo,
  buildAuthLoginHref,
  createAuthIntent,
  legacyIntentForAction,
  persistAuthIntent,
  type AuthIntent,
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

type AuthIntentNavigationState = Readonly<{
  ready: boolean;
  authenticated: boolean;
}>;

function sourceHref(input: CreateAuthIntentInput): string {
  return `${input.sourcePath}${input.sourceQuery}${input.returnAnchor ?? ""}`;
}

export function resolveAuthIntentHref(
  input: CreateAuthIntentInput,
  locale: "ko" | "en",
  state: AuthIntentNavigationState,
): string | undefined {
  if (!state.ready) return undefined;
  return state.authenticated
    ? sourceHref(input)
    : fallbackHref(input, locale);
}

export function resolveAuthIntentDestination(
  intent: AuthIntent,
  locale: "ko" | "en",
  state: AuthIntentNavigationState,
): string | null {
  if (!state.ready) return null;
  return state.authenticated
    ? authIntentReturnTo(intent)
    : buildAuthLoginHref(intent, locale);
}

export function AuthIntentLink({
  input,
  locale,
  className,
  children,
  ariaLabel,
  ariaDescribedBy,
  emphasis,
  focusKey,
}: {
  input: CreateAuthIntentInput;
  locale: "ko" | "en";
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  emphasis?: "primary";
  focusKey?: string;
}) {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const authState = { ready, authenticated };
  const href = resolveAuthIntentHref(input, locale, authState);

  function begin(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (!ready) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    const intent = createAuthIntent(input);
    persistAuthIntent(window.sessionStorage, intent);
    rememberOverlayTrigger(
      event.currentTarget,
      focusKey ? `[data-overlay-focus-key="${focusKey}"]` : undefined,
    );
    const destination = resolveAuthIntentDestination(intent, locale, authState);
    if (destination) router.push(destination as Route);
  }

  return (
    <a
      className={className}
      href={href}
      role="link"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-busy={!ready || undefined}
      aria-disabled={!ready || undefined}
      data-fan-action-emphasis={emphasis}
      data-overlay-focus-key={focusKey}
      onClick={begin}
    >
      {children}
    </a>
  );
}
