import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AdminScheduleForm } from "./participation-controls";
it("submits a complete bilingual schedule with zoned times and no fan-only payload fields", () => {
  const save = vi.fn(), invalid = vi.fn();
  const { container } = render(<AdminScheduleForm locale="ko" creators={[{ id: "10000000-0000-4000-8000-000000000001", slug: "artist", nameKo: "아티스트", nameEn: "Artist", status: "published" }]} busy={false} onSave={save} onInvalid={invalid} />);
  expect(screen.getByRole("combobox", { name: "팬페이지" })).toHaveAttribute("name", "celebrityId");
  const values = { celebrityId: "10000000-0000-4000-8000-000000000001", title: "공연", titleEn: "Concert", startsAt: "2026-10-01T01:00", endsAt: "2026-10-01T02:00", sourceUrl: "https://example.test/concert" };
  for (const [name, value] of Object.entries(values)) fireEvent.change(container.querySelector(`[name="${name}"]`)!, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(invalid).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: { ko: "공연", en: "Concert" }, startsAt: "2026-09-30T16:00:00.000Z", officialSourceUrl: "https://example.test/concert", status: "draft" }));
  expect(save.mock.calls[0][0]).not.toHaveProperty("sourceUrl");
});
