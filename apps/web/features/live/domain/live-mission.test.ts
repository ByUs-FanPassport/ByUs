import { describe, expect, it } from "vitest";
import { liveMissionSchema } from "./live-mission";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "vote",
  version: 1,
  title: "무대 선택",
  description: "",
  attendanceRequired: false,
  completed: false,
  visibleFrom: "2026-09-03T00:00:00.000Z",
  visibleUntil: "2026-09-04T00:00:00.000Z",
  questions: [{
    id: "22222222-2222-4222-8222-222222222222",
    text: "어떤 무대가 좋아요?",
    media: null,
    options: [
      { id: "33333333-3333-4333-8333-333333333333", label: "파란 무대", displayMode: "media", media: { type: "image", url: "https://byus.test/blue.webp" } },
      { id: "44444444-4444-4444-8444-444444444444", label: "분홍 무대", displayMode: "text", media: null },
    ],
  }],
};

describe("live Mission media presentation", () => {
  it("retains accessible option labels for visual media-only mode", () => {
    expect(liveMissionSchema.parse(base).questions[0].options[0]).toEqual(expect.objectContaining({
      label: "파란 무대",
      displayMode: "media",
    }));
  });

  it("rejects media-only mode without media", () => {
    const invalid = structuredClone(base);
    invalid.questions[0].options[0].media = null;
    expect(() => liveMissionSchema.parse(invalid)).toThrow();
  });
});
