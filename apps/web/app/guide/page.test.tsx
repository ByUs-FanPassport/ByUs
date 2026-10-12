import { describe, expect, it } from "vitest";

import { generateMetadata } from "./page";

describe("guide metadata", () => {
  it("publishes Korean and English self-canonicals", async () => {
    const ko = await generateMetadata({ searchParams: Promise.resolve({ locale: "ko" }) });
    const en = await generateMetadata({ searchParams: Promise.resolve({ locale: "en" }) });

    expect(ko.alternates?.canonical).toBe("https://kyaa.io/guide?locale=ko");
    expect(ko.title).toBe("이용 가이드와 자주 묻는 질문 | kyaa");
    expect(en.alternates?.canonical).toBe("https://kyaa.io/guide?locale=en");
    expect(en.title).toBe("Guide and Frequently Asked Questions | kyaa");
  });
});
