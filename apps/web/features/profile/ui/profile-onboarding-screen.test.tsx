import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileOnboardingScreen } from "./profile-onboarding-screen";

const replace = vi.fn();
const getAccessToken = vi.fn();
let authenticated = true;
let ready = true;
let query = "returnTo=%2Fc%2Fkara%2Fverify%3Fstep%3Dintro%23fan-verify&intent=passport&entity=kara&locale=ko";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready, authenticated, getAccessToken }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

describe("FAN-005 profile onboarding", () => {
  beforeEach(() => {
    replace.mockClear();
    authenticated = true;
    ready = true;
    query = "returnTo=%2Fc%2Fkara%2Fverify%3Fstep%3Dintro%23fan-verify&intent=passport&entity=kara&locale=ko";
    getAccessToken.mockResolvedValue("privy-access-token");
    sessionStorage.clear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
  });

  it("requires authentication and preserves the sanitized continuation context", async () => {
    authenticated = false;
    render(<ProfileOnboardingScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/login?returnTo=%2Fonboarding%2Fprofile%3FreturnTo%3D%252Fc%252Fkara%252Fverify%253Fstep%253Dintro%2523fan-verify%26locale%3Dko%26intent%3Dpassport%26entity%3Dkara&locale=ko&intent=passport&entity=kara",
    ));
  });

  it("skips the setup screen when the authenticated user already has a profile", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ profile: { completed: true, nickname: "Kamilia" } }));
    render(<ProfileOnboardingScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"));
  });

  it("updates the owner preview live and enables save only for a valid 2-16 character nickname", async () => {
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    const save = screen.getByRole("button", { name: "닉네임 저장" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "J" } });
    expect(screen.getByText("2–16자의 허용된 문자로 입력해 주세요.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "John 팬" } });
    expect(screen.getByText("John 팬")).toBeInTheDocument();
    expect(screen.getByLabelText("6/16자")).toBeInTheDocument();
    expect(screen.getByText("사용 가능한 형식이에요. 저장할 때 중복 여부를 확인합니다.")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it.each([
    ["NICKNAME_TAKEN", "이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요."],
    ["NICKNAME_PROHIBITED", "사용할 수 없는 표현이 포함되어 있어요. 다른 이름을 입력해 주세요."],
    ["INVALID_NICKNAME", "닉네임의 길이 또는 문자를 확인해 주세요."],
  ])("preserves and refocuses the input for %s", async (code, message) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ error: { code } }, { status: code === "NICKNAME_TAKEN" ? 409 : 400 }));
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "Kamilia" } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Kamilia");
  });

  it("preserves input and focus after a recoverable network failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockRejectedValueOnce(new Error("network"));
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "Kamilia" } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("입력한 닉네임을 유지했으니 다시 시도해 주세요.");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Kamilia");
  });

  it("resumes the original action if another tab completed the profile first", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ error: { code: "PROFILE_ALREADY_COMPLETED" } }, { status: 409 }));
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "Kamilia" } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"));
  });

  it("posts the normalized nickname once and restores the exact route after the saved state", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true, nickname: "John" } }));
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "  John  " } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/me/nickname", expect.objectContaining({
      method: "POST", body: JSON.stringify({ nickname: "John" }),
      headers: { authorization: "Bearer privy-access-token", "content-type": "application/json" },
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("저장 완료");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"), { timeout: 1_000 });
  });

  it("renders complete English copy without changing the continuation", async () => {
    query = "returnTo=%2Flive%2Fkara-nualeaf%3Flocale%3Den%23fan-code&intent=reserve&entity=kara-nualeaf&locale=en";
    render(<ProfileOnboardingScreen />);
    expect(await screen.findByRole("heading", { name: "Choose the nickname shown in fan activities." })).toBeInTheDocument();
    expect(screen.getByText("Only this nickname is public. Your email and Google account details are never shown.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EN" })).toHaveAttribute("aria-current", "page");
  });

  it("restores an unsaved nickname after reload or locale navigation", async () => {
    sessionStorage.setItem("byus:profile-nickname-draft", "Kamilia");
    render(<ProfileOnboardingScreen />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    await waitFor(() => expect(input).toHaveValue("Kamilia"));
    expect(screen.getByRole("button", { name: "닉네임 저장" })).toBeEnabled();
  });
});
