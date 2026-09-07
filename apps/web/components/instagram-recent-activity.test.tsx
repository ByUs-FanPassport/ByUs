import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/image", () => ({ default: ({ src, alt, onError }: { src: string; alt: string; onError: () => void }) => React.createElement("img", { src, alt, onError }) }));
import { InstagramRecentActivity } from "./instagram-recent-activity";

const card = (id: string, mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM") => ({ id, mediaType, mediaProductType: mediaType === "VIDEO" ? "REELS" : "FEED", imageUrl: `https://cdninstagram.com/${id}.jpg`, permalink: `https://www.instagram.com/p/post${id}/`, caption: `최근 소식 ${id}`, timestamp: "2026-09-08T00:00:00Z", sourceAccount: { id: "178400000000001", username: "creator_test" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Instagram recent activity", () => {
  it("uses three original links and shows the play mark only for a video", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [card("1", "IMAGE"), card("2", "VIDEO"), card("3", "CAROUSEL_ALBUM")] })));
    const { container } = render(<InstagramRecentActivity slug="katseye" locale="ko" />);
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "https://www.instagram.com/p/post1/");
    expect(links.every((link) => link.getAttribute("target") === "_blank")).toBe(true);
    expect(links[0].querySelector("svg")).toBeNull();
    expect(links[1].querySelector("svg")).not.toBeNull();
    expect(links[2].querySelector("svg")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });
  it.each([Response.json({ items: [] }), Response.json({ error: "unavailable" }, { status: 503 })])("does not invent cards for missing or failed media", async (response) => {
    const request = vi.fn(async () => response);
    vi.stubGlobal("fetch", request);
    const { container } = render(<InstagramRecentActivity slug="katseye" locale="ko" />);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
