import type { MetadataRoute } from "next";
import type { AppLocale } from "./locale-path";

export function createManifest(locale: AppLocale): MetadataRoute.Manifest {
  return {
    name: "ByUs | Your Bias",
    short_name: "ByUs",
    description: locale === "en" ? "Record moments with each of your favorites in a Fan Passport." : "최애의 라이브와 함께한 순간을 Fan Passport에 기록하세요.",
    id: "/",
    start_url: `/?locale=${locale}`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: locale,
    orientation: "portrait-primary",
    icons: [
      {
        src: "/byus-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/byus-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
