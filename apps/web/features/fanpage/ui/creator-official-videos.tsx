import { FanSectionHeader } from "@/components/fan-ui/fan-heading";
import type { AppLocale } from "@/i18n/locales";
import styles from "./fanpage.module.css";

const titles: Record<AppLocale, string> = {
  ko: "공식 영상", en: "Official videos", ja: "公式動画",
  "zh-Hans": "官方视频", "zh-Hant": "官方影片", es: "Vídeos oficiales",
  id: "Video resmi", vi: "Video chính thức", th: "วิดีโออย่างเป็นทางการ",
  pt: "Vídeos oficiais", fr: "Vidéos officielles",
};

const channels: Record<string, { name: string; id: string; videoId?: string }> = {
  nchive: { name: "NCHIVE", id: "UCO-svEJBdWiaViuy0TxVFFg" },
  wena: { name: "We;Na", id: "UCpiXCVf9CaYppJQDDyiD6nA", videoId: "172bEkNPqqs" },
};

export function CreatorOfficialVideos({ slug, locale }: { slug: string; locale: AppLocale }) {
  const channel = Object.hasOwn(channels, slug) ? channels[slug] : undefined;
  if (!channel) return null;
  return <section className={styles.officialVideos} aria-labelledby="official-videos-heading">
    <FanSectionHeader
      id="official-videos-heading"
      title={titles[locale]}
      action={{ label: "YouTube", href: `https://www.youtube.com/channel/${channel.id}` }}
    />
    <iframe
      className={styles.officialVideoFrame}
      title={`${channel.name} · ${titles[locale]}`}
      src={`${channel.videoId ? `https://www.youtube.com/embed/${channel.videoId}?` : `https://www.youtube.com/embed?listType=playlist&list=UU${channel.id.slice(2)}&`}autoplay=0&playsinline=1&hl=${locale}`}
      loading="lazy"
      allow="encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </section>;
}
