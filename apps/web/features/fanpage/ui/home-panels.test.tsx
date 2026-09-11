import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedCelebrity, PublishedCelebrityLive } from "@/server/content/content-domain";
import { NoticePanel, RecentLive } from "./home-panels";
import { ifewEventBanner } from "@/components/ifew-fan-guide/content";
import { ifewLiveSlug } from "@/features/live/domain/ifew-event";

const mock = vi.hoisted(() => ({ notices: [] as { slug: string; title: string; pinned: boolean; publishedAt: string }[] }));
vi.mock("./use-fanpage-resource", () => ({ useFanpageResource: () => ({ state: { status: "ready", data: mock.notices }, retry: vi.fn() }) }));
vi.mock("./notice-comments", () => ({ NoticeComments: ({ preview }: { preview: boolean }) => <span>{preview ? "Comments preview" : "Comments"}</span> }));
beforeEach(() => { mock.notices = []; });

const celebrity: PublishedCelebrity = {
  slug: "creator", locale: "ko", name: "Creator", summary: "Summary",
  image: { url: "/creator.jpg", alt: "Creator", position: "center" },
  roles: ["creator"], themes: [], socialLinks: [], displayOrder: 0, fanCount: 0,
};

const live: PublishedCelebrityLive = {
  slug: "creator-live", celebritySlug: "creator", locale: "ko", title: "Creator LIVE",
  startsAt: "2026-09-12T00:00:00.000Z", effectiveStatus: "scheduled",
  photos: {
    poster: {
      asset: { id: "asset", url: "https://assets.example/registered-poster.webp", width: 960, height: 480, mimeType: "image/webp", revision: 1 },
      alt: { ko: "등록된 LIVE 포스터", en: "Registered LIVE poster" }, frames: {}, revision: 1,
    },
  },
};

describe("RecentLive", () => {
  it("uses the registered public poster when no active-preview poster exists", () => {
    render(<RecentLive celebrity={celebrity} locale="ko" upcomingLive={live} />);

    expect(screen.getByAltText("등록된 LIVE 포스터")).toHaveAttribute("src", expect.stringContaining("registered-poster.webp"));
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("keeps the active-preview poster ahead of the registered editorial poster", () => {
    render(<RecentLive celebrity={celebrity} locale="ko" upcomingLive={{
      ...live,
      preview: {
        kind: "artist_teaser", durationMs: 3_000,
        square: { videoUrl: "https://assets.example/preview.mp4", posterUrl: "https://assets.example/active-preview.webp" },
      },
    }} />);

    expect(document.querySelector('img[src*="active-preview.webp"]')).toBeInTheDocument();
    expect(screen.queryByAltText("등록된 LIVE 포스터")).not.toBeInTheDocument();
  });
});


it("reuses the approved ifew event artwork only for that event when the role is missing", () => {
  render(<RecentLive celebrity={celebrity} locale="ko" upcomingLive={{ ...live, slug: ifewLiveSlug, photos: undefined }} />);
  expect(decodeURIComponent(screen.getByAltText(live.title).getAttribute("src") ?? "")).toContain(ifewEventBanner);
});

it("respects explicit poster removal and keeps an image-free live link", () => {
  const { container } = render(<RecentLive celebrity={celebrity} locale="en" upcomingLive={{ ...live, slug: ifewLiveSlug, photos: { poster: null } }} />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByRole("link", { name: /Creator LIVE/ })).toHaveAttribute("href", `/live/${ifewLiveSlug}?locale=en`);
  expect(screen.getByText(/KST/)).toBeInTheDocument();
});

it("uses a concise empty notice status without linking to an empty notice list", () => {
  render(<NoticePanel slug="ifewknow" locale="ko" />);
  expect(screen.getByRole("status")).toHaveTextContent("아직 등록된 공지가 없어요.");
  expect(screen.queryByRole("link", { name: /공지 전체 보기/ })).not.toBeInTheDocument();
});

it("preserves notice navigation and comment preview when a notice is published", () => {
  mock.notices = [{ slug: "live-guide", title: "LIVE 참여 안내", pinned: true, publishedAt: "2026-09-11T00:00:00Z" }];
  render(<NoticePanel slug="ifewknow" locale="ko" />);
  expect(screen.getByRole("link", { name: /LIVE 참여 안내/ })).toHaveAttribute("href", "/c/ifewknow/notices/live-guide?locale=ko");
  expect(screen.getByRole("link", { name: /공지 전체 보기/ })).toHaveAttribute("href", "/c/ifewknow?tab=notice&locale=ko#celebrity-content");
  expect(screen.getByText("Comments preview")).toBeInTheDocument();
});
