import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { CommunityScreen } from "./community-screen";

const push = vi.hoisted(() => vi.fn());
let fanCount = 99;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/fan-shell/fan-app-shell", () => ({ FanAppFrame: ({ children }: React.PropsWithChildren) => <>{children}</>, FanContentContainer: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/fan-ui/creator-avatar", () => ({ CreatorAvatar: () => null }));
vi.mock("@/features/fan-posts/ui/fan-post-feed", () => ({ FanPostFeed: ({ slug, returnTo }: { slug: string; returnTo: string }) => <div data-testid="posts" data-slug={slug} data-return={returnTo} /> }));
vi.mock("@/features/certification/ui/certification-panel", () => ({ CertificationPanel: ({ slug }: { slug: string }) => <div data-testid="certifications" data-slug={slug} /> }));
vi.mock("@/features/fanpage/ui/leaderboard-panel", () => ({ LeaderboardPanel: ({ slug }: { slug: string }) => <div data-testid="ranking" data-slug={slug} /> }));
vi.mock("@/features/fanpage/ui/home-panels", () => ({ ResourceMessage: () => null }));
vi.mock("@/features/fanpage/ui/use-community-resource", () => ({ useCommunityResource: () => ({ state: { status: "ready", data: { likeCount: fanCount, fanCount, publicFanCount: fanCount, fans: [{ nickname: "별빛팬", avatarUrl: "/images/avatars/star-pink.webp" }] } }, retry: vi.fn() }) }));
const creators = ["elina", "yuna"].map((slug, displayOrder) => ({ slug, locale: "ko", name: slug, summary: "", roles: ["creator"], themes: [], socialLinks: [], displayOrder, fanCount: 0, image: { url: "/images/guest-home/elina-card.jpg", alt: slug, position: "center" } })) as PublishedCelebrity[];
beforeEach(() => { push.mockClear(); fanCount = 99; });

it("keeps the selected artist and locale across tabs, login return and creator switch", () => {
  render(<CommunityScreen creators={creators} creator={creators[0]} locale="ko" />);
  expect(screen.getByTestId("posts")).toHaveAttribute("data-slug", "elina");
  expect(screen.getByTestId("posts")).toHaveAttribute("data-return", "/community?creator=elina&tab=posts&locale=ko");
  const tabs = screen.getByRole("navigation", { name: "커뮤니티" });
  expect(within(tabs).getByRole("link", { name: "찐팬 인증" })).toHaveAttribute("href", "/community?creator=elina&tab=certifications&locale=ko");
  expect(screen.getByRole("link", { name: "LIVE" })).toHaveAttribute("href", "/elina?tab=live&locale=ko#celebrity-content");
  fireEvent.change(screen.getByLabelText("최애 선택"), { target: { value: "yuna" } });
  expect(push).toHaveBeenCalledWith("/community?creator=yuna&tab=posts&locale=ko");
});

it("shows recent fans at 99 and replaces them with the leaderboard at 100", () => {
  const view = render(<CommunityScreen creators={creators} creator={creators[1]} locale="ko" tab="fans" />);
  expect(screen.getByText("99명")).toBeInTheDocument();
  expect(screen.getAllByText("별빛팬")).toHaveLength(1);
  expect(screen.queryByTestId("ranking")).not.toBeInTheDocument();
  fanCount = 100;
  view.rerender(<CommunityScreen creators={creators} creator={creators[1]} locale="ko" tab="fans" />);
  expect(screen.getByTestId("ranking")).toHaveAttribute("data-slug", "yuna");
  expect(screen.queryByText("별빛팬")).not.toBeInTheDocument();
  view.rerender(<CommunityScreen creators={creators} creator={creators[1]} locale="ko" tab="certifications" />);
  expect(screen.getByTestId("certifications")).toHaveAttribute("data-slug", "yuna");
});

it("routes requests to existing artist-specific forms and handles an empty directory", () => {
  const view = render(<CommunityScreen creators={creators} creator={creators[1]} locale="ko" tab="requests" />);
  expect(screen.getByRole("link", { name: /일정 제안/ })).toHaveAttribute("href", "/c/yuna/schedule-suggestions?locale=ko");
  expect(screen.getByRole("link", { name: "팬페이지 개설 신청" })).toHaveAttribute("href", "/bias/requests?locale=ko");
  view.rerender(<CommunityScreen creators={[]} locale="ko" />);
  expect(screen.getByRole("status")).toHaveTextContent("참여할 커뮤니티를 준비하고 있어요.");
  expect(screen.queryByLabelText("최애 선택")).not.toBeInTheDocument();
});
