import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatorOfficialVideos } from "./creator-official-videos";

describe("verified official channels", () => {
  it.each([
    ["wena", "We;Na", "UCpiXCVf9CaYppJQDDyiD6nA"],
    ["nchive", "NCHIVE", "UCO-svEJBdWiaViuy0TxVFFg"],
  ])("shows %s's verified official video without autoplay", (slug, name, id) => {
    render(<CreatorOfficialVideos slug={slug} locale="ja" />);
    const source = new URL(screen.getByTitle(`${name} · 公式動画`).getAttribute("src")!);
    expect(source.origin).toBe("https://www.youtube.com");
    if (slug === "wena") {
      expect(source.pathname).toBe("/embed/172bEkNPqqs");
      expect(source.searchParams.has("list")).toBe(false);
    } else {
      expect(source.searchParams.get("list")).toBe(`UU${id.slice(2)}`);
    }
    expect(source.searchParams.get("autoplay")).toBe("0");
    expect(source.searchParams.get("hl")).toBe("ja");
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute("href", `https://www.youtube.com/channel/${id}`);
  });
  it.each(["unknown", "constructor"])("does not guess a channel for %s", slug => {
    const { container } = render(<CreatorOfficialVideos slug={slug} locale="ko" />);
    expect(container).toBeEmptyDOMElement();
  });
});
