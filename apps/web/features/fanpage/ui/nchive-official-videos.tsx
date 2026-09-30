import { FanSectionHeader } from "@/components/fan-ui/fan-heading";
import type { AppLocale } from "@/i18n/locales";
import styles from "./fanpage.module.css";

const titles: Record<AppLocale, string> = {
  ko: "공식 영상", en: "Official videos", ja: "公式動画",
  "zh-Hans": "官方视频", "zh-Hant": "官方影片", es: "Vídeos oficiales",
  id: "Video resmi", vi: "Video chính thức", th: "วิดีโออย่างเป็นทางการ",
  pt: "Vídeos oficiais", fr: "Vidéos officielles",
};

export function NchiveOfficialVideos({ locale }: { locale: AppLocale }) {
  return <section className={styles.officialVideos} aria-labelledby="official-videos-heading">
    <FanSectionHeader
      id="official-videos-heading"
      title={titles[locale]}
      action={{ label: "YouTube", href: "https://www.youtube.com/channel/UCO-svEJBdWiaViuy0TxVFFg" }}
    />
    <iframe
      className={styles.officialVideoFrame}
      title={`NCHIVE · ${titles[locale]}`}
      src={`https://www.youtube.com/embed?listType=playlist&list=UUO-svEJBdWiaViuy0TxVFFg&autoplay=0&playsinline=1&hl=${locale}`}
      loading="lazy"
      allow="encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </section>;
}
