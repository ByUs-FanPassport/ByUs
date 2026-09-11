import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublishedCelebrity, PublishedCelebrityLive } from "@/server/content/content-domain";
import { RecentLive } from "./home-panels";

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
