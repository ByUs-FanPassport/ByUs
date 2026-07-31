import type { Metadata } from "next";

export const BYUS_BRAND_ICONS = {
  icon: [
    { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
  ],
  apple: [
    {
      url: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  ],
} satisfies Metadata["icons"];
