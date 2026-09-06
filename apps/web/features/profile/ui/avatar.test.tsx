import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./avatar";

const avatar = {
  initialCharacterId: "star-cream" as const,
  characterId: "ghost-lavender" as const,
  source: "upload" as const,
  hasImage: true,
  revision: 3,
};

describe("Avatar", () => {
  it("falls back to the selected catalog character when the private photo cannot render", () => {
    render(<Avatar avatar={avatar} imageUrl="blob:private" label="프로필 이미지" />);
    const image = screen.getByRole("img", { name: "프로필 이미지" });
    expect(image).toHaveAttribute("src", "blob:private");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/images/avatars/ghost-lavender.webp");
  });
});
