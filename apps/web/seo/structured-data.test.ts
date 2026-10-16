import { describe, expect, it } from "vitest";

import { faqStructuredData, homeStructuredData, serializeStructuredData } from "./structured-data";

describe("public structured data", () => {
  it("connects one stable WebSite identity to the confirmed kyaa operator", () => {
    const data = homeStructuredData();
    const organization = data["@graph"][0];
    const website = data["@graph"][1];

    expect(organization).toMatchObject({
      "@type": "Organization",
      "@id": "https://kyaa.io/#organization",
      name: "Sallylab Inc.",
      url: "https://kyaa.io/",
      email: "support@kyaa.io",
      brand: { "@type": "Brand", name: "kyaa", url: "https://kyaa.io/" },
    });
    expect(organization.sameAs).toEqual([
      "https://www.instagram.com/official_byus/",
      "https://x.com/official_byus",
      "https://www.threads.com/@official_byus",
      "https://t.me/Kyaa_Official",
    ]);
    expect(website).toEqual({
      "@type": "WebSite",
      "@id": "https://kyaa.io/#website",
      url: "https://kyaa.io/",
      name: "kyaa",
      publisher: { "@id": "https://kyaa.io/#organization" },
    });
  });

  it("maps only the visible questions and answers into FAQPage data", () => {
    const data = faqStructuredData([
      { question: "Is a reservation an entry?", answer: "No. Enter separately." },
    ]);
    expect(data.mainEntity).toEqual([{
      "@type": "Question",
      name: "Is a reservation an entry?",
      acceptedAnswer: { "@type": "Answer", text: "No. Enter separately." },
    }]);
  });

  it("serializes JSON-LD without allowing a closing script tag", () => {
    const serialized = serializeStructuredData({ text: "</script><script>alert(1)</script>\u2028next" });
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c/script>");
    expect(serialized).toContain("\\u2028next");
    expect(JSON.parse(serialized)).toEqual({ text: "</script><script>alert(1)</script>\u2028next" });
  });
});
