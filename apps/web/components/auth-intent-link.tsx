"use client";

import { withLocalePath } from "./locale-path";
import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
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
import { getSessionStorage } from "../features/reliability/client/session-storage";
import { useByUsSession } from "./byus-session-provider";

function fallbackHref(input: CreateAuthIntentInput, locale: "ko" | "en"): string {
  const returnTo = `${input.sourcePath}${input.sourceQuery}${input.returnAnchor ?? ""}`;
  const query = new URLSearchParams({
    returnTo: withLocalePath(returnTo, locale),
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
    ? withLocalePath(sourceHref(input), locale)
    : fallbackHref(input, locale);
}

export function resolveAuthIntentDestination(
  intent: AuthIntent,
  locale: "ko" | "en",
  state: AuthIntentNavigationState,
): string | null {
  if (!state.ready) return null;
  return state.authenticated
    ? withLocalePath(authIntentReturnTo(intent), locale)
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
  pendingHref?: string;
}) {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const session = useByUsSession();
  const sessionReady = ready && session.ready;
  const authState = { ready: sessionReady, authenticated };
  const href = sessionReady ? resolveAuthIntentHref(input, locale, authState) : undefined;
  const beginningRef = useRef(false);
  const beginningTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (beginningTimerRef.current !== null) window.clearTimeout(beginningTimerRef.current);
  }, []);

  function begin(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (!sessionReady) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (beginningRef.current) return;
    beginningRef.current = true;
    beginningTimerRef.current = window.setTimeout(() => {
      beginningRef.current = false;
      beginningTimerRef.current = null;
    }, 1_000);
    const intent = createAuthIntent(input);
    persistAuthIntent(getSessionStorage(), intent);
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
      aria-busy={!sessionReady || undefined}
      aria-disabled={!sessionReady || undefined}
      data-fan-action-emphasis={emphasis}
      data-overlay-focus-key={focusKey}
      onClick={begin}
    >
      {children}
    </a>
  );
}
