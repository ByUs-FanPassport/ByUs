import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CreatorAvatar } from "./creator-avatar";

it("replaces a failed image and recovers when the source changes", () => {
  const { rerender } = render(<CreatorAvatar slug="elina" src="/first.jpg" size={24} alt="Elina" />);
  fireEvent.error(screen.getByRole("img", { name: "Elina" }));
  expect(screen.getByRole("img", { name: "Elina" }).tagName.toLowerCase()).toBe("svg");
  rerender(<CreatorAvatar slug="elina" src="/second.jpg" size={24} alt="Elina" />);
  expect(screen.getByRole("img", { name: "Elina" }).tagName.toLowerCase()).toBe("img");
});
it("keeps adjacent-name avatars decorative and reserves the requested size without a photo", () => {
  const { container } = render(<CreatorAvatar slug="unknown" src={null} size={24} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.firstElementChild).toHaveStyle("--avatar-size: 24px");
});
