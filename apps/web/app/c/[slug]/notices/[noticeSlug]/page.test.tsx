import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/server/seo/public-content", () => ({ loadSeoCreator: vi.fn(async () => ({ roles: ["brand"] })) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/components/fan-shell/fan-app-shell", () => ({ FanAppFrame: ({ children }: { children: ReactNode }) => <>{children}</>, FanContentContainer: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/notice/notice-detail", () => ({ NoticeDetail: ({ officialPostLabel }: { officialPostLabel?: string }) => <span>{officialPostLabel}</span> }));

import NoticeDetailPage from "./page";

describe("brand notice detail route", () => {
  it("passes localized brand copy to the public notice renderer", async () => {
    render(await NoticeDetailPage({ params: Promise.resolve({ slug: "runmusic", noticeSlug: "update" }), searchParams: Promise.resolve({ locale: "ja" }) }));
    expect(screen.getByText("ブランド情報")).toBeInTheDocument();
  });
});
