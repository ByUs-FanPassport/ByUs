import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivePreviewCoordinator,
  ActivePreviewVideo,
} from "./active-preview-video";
import { LiveStatusIndicator } from "./live-status-indicator";

const first = {
  videoUrl: "https://assets.example/first.mp4",
  posterUrl: "https://assets.example/first.webp",
  durationMs: 4_000,
};
const second = {
  videoUrl: "https://assets.example/second.mp4",
  posterUrl: "https://assets.example/second.webp",
  durationMs: 4_000,
};

describe("Active Preview UI", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
  });

  it("moves the single playback lease between card hover targets", () => {
    render(
      <ActivePreviewCoordinator initialActiveId="first">
        <div data-testid="first">
          <ActivePreviewVideo id="first" preview={first} mode="card" />
        </div>
        <div data-testid="second">
          <ActivePreviewVideo id="second" preview={second} mode="card" />
        </div>
      </ActivePreviewCoordinator>,
    );

    const videos = screen.getAllByTestId("active-preview-video");
    expect(videos[0]).toHaveAttribute("src", first.videoUrl);
    expect(videos[1]).not.toHaveAttribute("src");
    fireEvent.pointerEnter(videos[1].parentElement!);
    expect(videos[0]).not.toHaveAttribute("src");
    expect(videos[1]).toHaveAttribute("src", second.videoUrl);
  });

  it("keeps actual LIVE semantics separate from scheduled status", () => {
    const { rerender } = render(
      <LiveStatusIndicator status="live" locale="ko" />,
    );
    expect(screen.getByText("LIVE 진행중")).toHaveAttribute(
      "data-live-status",
      "live",
    );
    rerender(<LiveStatusIndicator status="scheduled" locale="ko" />);
    expect(screen.getByText("LIVE 예정")).toHaveAttribute(
      "data-live-status",
      "scheduled",
    );
  });

  it("offers a 44px playback control on a detail preview", () => {
    render(
      <ActivePreviewVideo
        id="detail"
        preview={first}
        mode="detail"
        locale="ko"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Preview 일시정지" }),
    ).toBeInTheDocument();
  });
});
