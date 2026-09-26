import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissionBuilder } from "./mission-builder";

const getAccessToken = vi.fn(async () => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/lives/live-1/missions",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { email: "ops@byus.test", role: "operator" } }),
}));

describe("MissionBuilder", () => {
  beforeEach(() => {
    getAccessToken.mockClear();
  });

  it("renders inside the admin shell with usable controls and a truthful empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ missions: [] })));
    const { container } = render(<MissionBuilder liveEventId="live-1" />);

    expect(await screen.findByText("아직 집계된 미션 통계가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "미션 빌더" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "미션 유형" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안 만들기" })).toBeDisabled();
    expect(container.querySelector("main main")).toBeNull();
  });

  it("separates a statistics failure from an empty result and retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ missions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MissionBuilder liveEventId="live-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("미션 통계를 불러오지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("아직 집계된 미션 통계가 없습니다.")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
