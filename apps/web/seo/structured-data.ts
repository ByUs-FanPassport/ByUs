import { SITE_URL } from "./metadata";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export type PublicFaq = {
  question: string;
  answer: string;
};

/**
 * Keep the site identity identical on every localized home URL. The legal
 * pages identify Sallylab Inc. as the company that provides ByUs, while these
 * social URLs are the official ByUs channels published in the site footer.
 */
export function homeStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "Sallylab Inc.",
        url: `${SITE_URL}/`,
        email: "biz@sallylab.io",
        brand: {
          "@type": "Brand",
          name: "ByUs",
          url: `${SITE_URL}/`,
        },
        sameAs: [
          "https://www.instagram.com/official_byus/",
          "https://x.com/official_byus",
          "https://www.threads.com/@official_byus",
          "https://t.me/ByUs_official",
        ],
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: `${SITE_URL}/`,
        name: "ByUs",
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  } as const;
}

export function faqStructuredData(faqs: readonly PublicFaq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  } as const;
}

/** Escape script-breaking characters while preserving valid JSON. */
export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
