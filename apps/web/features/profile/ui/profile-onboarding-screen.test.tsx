import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileOnboardingScreen } from "./profile-onboarding-screen";

const replace = vi.fn();
const getAccessToken = vi.fn();
let authenticated = true;
let ready = true;
let query = "returnTo=%2Fc%2Fkara%2Fverify%3Fstep%3Dintro%23fan-verify&intent=passport&entity=kara&locale=ko";
const celebrity = {
  slug: "kara",
  locale: "ko",
  name: "KARA",
  summary: "KARA summary",
  image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" },
  themes: [],
  socialLinks: [],
  displayOrder: 0,
  fanCount: 12_800_000,
} as const;

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
    const { rerender } = render(<ProfileOnboardingScreen celebrity={celebrity} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/login?returnTo=%2Fonboarding%2Fprofile%3FreturnTo%3D%252Fc%252Fkara%252Fverify%253Fstep%253Dintro%2523fan-verify%26locale%3Dko%26intent%3Dpassport%26entity%3Dkara&locale=ko&intent=passport&entity=kara",
    ));
    query = "returnTo=%2Fonboarding%2Fprofile%3FreturnTo%3D%252Fonboarding%252Fprofile%26locale%3Dko&locale=ko";
    rerender(<ProfileOnboardingScreen celebrity={celebrity} />);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("skips the setup screen when the authenticated user already has a profile", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ profile: { completed: true, nickname: "Kamilia" } }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"));
  });

  it("supports global 1-32 grapheme display names in the live owner preview", async () => {
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    expect(screen.getByLabelText("프로필 설정 · 1 / 1")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "닉네임 저장" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(save).toBeEnabled();

    fireEvent.change(input, { target: { value: "J" } });
    expect(screen.getByText("사용 가능한 형식이에요. 저장할 때 중복 여부를 확인합니다.")).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.change(input, { target: { value: "John 팬" } });
    expect(screen.getByText("John 팬")).toBeInTheDocument();
    expect(screen.getByText("팬 인증 완료 후 발급")).toBeInTheDocument();
    expect(screen.queryByText("Fan Score")).not.toBeInTheDocument();
    expect(screen.queryByText("Stamps")).not.toBeInTheDocument();
    expect(screen.getByLabelText("6/32자")).toBeInTheDocument();
    expect(screen.getByText("사용 가능한 형식이에요. 저장할 때 중복 여부를 확인합니다.")).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.change(input, { target: { value: "ليلى💜!" } });
    expect(screen.getByLabelText("6/32자")).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.change(input, { target: { value: "界".repeat(32) } });
    expect(screen.getByLabelText("32/32자")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it.each([
    ["NICKNAME_TAKEN", "이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.", undefined],
    ["NICKNAME_PROHIBITED", "사용할 수 없는 표현이 포함되어 있어요. 다른 닉네임을 입력해 주세요.", undefined],
    ["INVALID_NICKNAME", "사용할 수 없는 문자가 포함되어 있어요. 해당 문자를 지워 주세요.", "unsupported"],
  ])("preserves and refocuses the input for %s", async (code, message, reason) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ error: { code, details: reason ? { reason } : undefined } }, { status: code === "NICKNAME_TAKEN" ? 409 : 400 }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
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
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true, nickname: "Kamilia" } }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "Kamilia" } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("입력한 닉네임을 유지했으니 다시 시도해 주세요.");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Kamilia");
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"));
  });

  it("resumes the original action if another tab completed the profile first", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ error: { code: "PROFILE_ALREADY_COMPLETED" } }, { status: 409 }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    fireEvent.change(input, { target: { value: "Kamilia" } });
    fireEvent.click(screen.getByRole("button", { name: "닉네임 저장" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/kara/verify?step=intro#fan-verify"));
  });

  it("posts the normalized nickname once and restores the exact route after the saved state", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true, nickname: "John" } }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
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
    query = "returnTo=%2Fc%2Fkara%2Fverify%3Fstep%3Dintro%23fan-verify&intent=passport&entity=kara&locale=en";
    render(<ProfileOnboardingScreen celebrity={{ ...celebrity, locale: "en" }} />);
    expect(await screen.findByRole("heading", { name: "Choose a display name for your KARA fan verification." })).toBeInTheDocument();
    expect(screen.getByText("After verification, it will appear in your KARA Fan Passport and activity history.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("link", { name: "EN" })).toHaveAttribute("aria-current", "page");
  });

  it("restores an unsaved nickname after reload or locale navigation", async () => {
    sessionStorage.setItem("byus:profile-nickname-draft", "Kamilia");
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    await waitFor(() => expect(input).toHaveValue("Kamilia"));
    expect(screen.getByRole("button", { name: "닉네임 저장" })).toBeEnabled();
  });

  it("reveals exact validation on blur or save and refreshes it after correction", async () => {
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    const save = screen.getByRole("button", { name: "닉네임 저장" });
    const nicknameCallsBefore = vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/me/nickname").length;

    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("닉네임을 입력해 주세요.");
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, { target: { value: "가".repeat(33) } });
    expect(screen.getByRole("alert")).toHaveTextContent("닉네임은 32자까지 입력할 수 있어요.");
    expect(screen.getByLabelText("33/32자")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "민지💜!" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("닉네임을 입력해 주세요.");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/me/nickname")).toHaveLength(nicknameCallsBefore);
  });

  it("blocks submission while an IME composition is unfinished", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ profile: { completed: false, nickname: null } }))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true, nickname: "한" } }));
    render(<ProfileOnboardingScreen celebrity={celebrity} />);
    const input = await screen.findByRole("textbox", { name: "닉네임" });
    const save = screen.getByRole("button", { name: "닉네임 저장" });
    const nicknameCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/me/nickname");
    const callsBeforeComposition = nicknameCalls().length;

    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("닉네임을 입력해 주세요.");
    fireEvent.compositionStart(input);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(input, { target: { value: "ㅎ" } });
    fireEvent.click(save);
    expect(nicknameCalls()).toHaveLength(callsBeforeComposition);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "한" } });
    fireEvent.compositionEnd(input);
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(nicknameCalls()).toHaveLength(callsBeforeComposition + 1));
    expect(nicknameCalls().at(-1)?.[1]?.body).toBe(JSON.stringify({ nickname: "한" }));
  });
});
