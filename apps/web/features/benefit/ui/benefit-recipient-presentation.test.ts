import { describe, expect, it } from "vitest";

import { formatRecipientDeadline, fulfillmentStatusLabel } from "./benefit-recipient-presentation";

describe("benefit recipient presentation", () => {
  it("renders recipient deadlines in KST for both locales", () => {
    const deadline = "2026-09-28T15:00:00.000Z";
    expect(formatRecipientDeadline(deadline, "ko")).toBe("2026.09.29 00:00 (KST)");
    expect(formatRecipientDeadline(deadline, "en")).toBe("2026.09.29 00:00 (KST)");
  });

  it("describes ready as submitted information rather than pickup availability", () => {
    expect(fulfillmentStatusLabel.ready.ko).toBe("정보 접수 완료");
    expect(fulfillmentStatusLabel.ready.en).toBe("Information submitted");
  });
});
