import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthIntentLink,
  resolveAuthIntentDestination,
  resolveAuthIntentHref,
} from "./auth-intent-link";
import { createAuthIntent } from "./auth-intent";
import { takeOverlayTrigger } from "./ui/overlay/focus-return";

const push = vi.fn();
let ready = true;
let authenticated = false;
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready, authenticated }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("AuthIntentLink", () => {
  beforeEach(() => {
    push.mockReset();
    ready = true;
    authenticated = false;
    takeOverlayTrigger();
    sessionStorage.clear();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
  });

  const input = {
    sourcePath: "/c/kara/verify",
    sourceQuery: "?tab=home&locale=ko",
    actionType: "START_FAN_VERIFICATION",
    targetType: "celebrity",
    targetId: "kara",
  } as const;

  it("resolves pending, guest, and authenticated destinations without duplicating auth state", () => {
    const intent = createAuthIntent(input);

    expect(resolveAuthIntentDestination(intent, "ko", {
      ready: false,
      authenticated: false,
    })).toBeNull();
    expect(resolveAuthIntentHref(input, "ko", {
      ready: false,
      authenticated: false,
    })).toBeUndefined();
    expect(resolveAuthIntentDestination(intent, "ko", {
      ready: true,
      authenticated: false,
    })).toContain("/login?");
    expect(resolveAuthIntentDestination(intent, "ko", {
      ready: true,
      authenticated: true,
    })).toBe(
      "/c/kara/verify?tab=home&locale=ko&authIntent=11111111-1111-4111-8111-111111111111",
    );
    expect(resolveAuthIntentHref(input, "ko", {
      ready: true,
      authenticated: true,
    })).toBe("/c/kara/verify?tab=home&locale=ko");
  });

  it("keeps a safe fallback href and persists a durable exact action before client navigation", () => {
    render(
      <AuthIntentLink
        locale="ko"
        input={{
          sourcePath: "/live/kara-live",
          sourceQuery: "?locale=ko",
          returnAnchor: "#fan-code",
          actionType: "SUBMIT_FAN_CODE",
          targetType: "live_event",
          targetId: "kara-live",
        }}
      >로그인</AuthIntentLink>,
    );
    const link = screen.getByRole("link", { name: "로그인" });
    expect(link).toHaveAttribute("href", "/login?returnTo=%2Flive%2Fkara-live%3Flocale%3Dko%23fan-code&locale=ko&intent=attendance&entity=kara-live");

    fireEvent.click(link);
    expect(takeOverlayTrigger()?.element).toBe(link);
    expect(push).toHaveBeenCalledWith(expect.stringContaining("authIntent=11111111-1111-4111-8111-111111111111"));
    expect(JSON.parse(sessionStorage.getItem("byus:auth-intent:v1:11111111-1111-4111-8111-111111111111")!)).toMatchObject({
      actionType: "SUBMIT_FAN_CODE",
      targetId: "kara-live",
    });
  });

  it("does not navigate to login while Privy is still restoring the saved session", () => {
    ready = false;
    render(
      <AuthIntentLink locale="ko" input={input}>
        팬 인증하기
      </AuthIntentLink>,
    );

    const link = screen.getByRole("link", { name: "팬 인증하기" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).not.toHaveAttribute("href");
    fireEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage).toHaveLength(0);
  });

  it("allows an explicitly safe source fallback while Privy restores", () => {
    ready = false;
    render(
      <AuthIntentLink locale="ko" input={input} pendingHref="/c/kara?locale=ko">
        KARA 상세보기
      </AuthIntentLink>,
    );

    const link = screen.getByRole("link", { name: "KARA 상세보기" });
    expect(link).toHaveAttribute("href", "/c/kara?locale=ko");
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).not.toHaveAttribute("aria-disabled");
    fireEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage).toHaveLength(0);
  });

  it("routes an authenticated action directly with its durable intent", () => {
    authenticated = true;
    render(
      <AuthIntentLink locale="ko" input={input}>
        팬 인증하기
      </AuthIntentLink>,
    );

    const link = screen.getByRole("link", { name: "팬 인증하기" });
    expect(link).toHaveAttribute(
      "href",
      "/c/kara/verify?tab=home&locale=ko",
    );
    fireEvent.click(link);
    expect(push).toHaveBeenCalledWith(
      "/c/kara/verify?tab=home&locale=ko&authIntent=11111111-1111-4111-8111-111111111111",
    );
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/login"));
  });

  it("exposes the shared primary emphasis and helper relationship", () => {
    render(
      <>
        <AuthIntentLink
          locale="ko"
          input={input}
          emphasis="primary"
          ariaDescribedBy="fan-action-help"
        >
          로그인하기
        </AuthIntentLink>
        <p id="fan-action-help">LIVE를 예약하려면 먼저 로그인해 주세요.</p>
      </>,
    );

    const link = screen.getByRole("link", { name: "로그인하기" });
    expect(link).toHaveAttribute("data-fan-action-emphasis", "primary");
    expect(link).toHaveAccessibleDescription(
      "LIVE를 예약하려면 먼저 로그인해 주세요.",
    );
  });
});
