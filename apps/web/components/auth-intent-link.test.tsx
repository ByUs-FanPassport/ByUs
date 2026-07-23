import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthIntentLink } from "./auth-intent-link";
import { takeOverlayTrigger } from "./ui/overlay/focus-return";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("AuthIntentLink", () => {
  beforeEach(() => {
    push.mockReset();
    takeOverlayTrigger();
    sessionStorage.clear();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
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
});
