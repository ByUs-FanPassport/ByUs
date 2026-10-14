import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { AppLocale } from "@/i18n/locales";
import { translate } from "@/i18n/messages";
import { messages } from "@/i18n/catalogs/components__celebrity-fan-page";
import { creatorIdentity } from "../domain/creator-identities";
import styles from "./fanpage.module.css";

const fandomLabels: Record<AppLocale, string> = {
  ko: "팬덤", en: "Fandom", ja: "ファンダム", "zh-Hans": "粉丝名", "zh-Hant": "粉絲名",
  es: "Fandom", id: "Fandom", vi: "Cộng đồng fan", th: "แฟนด้อม", pt: "Fandom", fr: "Fandom",
};

export function CreatorFanIdentity({ slug, name, locale }: { slug: string; name: string; locale: AppLocale }) {
  const identity = creatorIdentity(slug);
  if (!identity) return <h1 id="celebrity-heading">{name}</h1>;
  const primary = identity.logo || locale !== "ko" ? identity.en : identity.ko;
  const secondary = primary === identity.ko ? identity.en : identity.ko;
  return <div className={styles.artistIdentity}>
    <div className={styles.artistName}>
      {identity.logo && <Image className={styles.artistLogo} src={identity.logo} alt="" width={80} height={80} />}
      <h1 id="celebrity-heading">{primary}<span>{secondary}</span></h1>
    </div>
    {identity.fandom && <dl className={styles.fandom}>
      <dt>{fandomLabels[locale]}</dt>
      <dd><a href={identity.fandom.source} target="_blank" rel="noopener noreferrer" data-outbound-kind="external" aria-label={`${fandomLabels[locale]} · ${identity.fandom.name} · ${identity.fandom.ko}, ${locale === "ko" ? "새 창" : translate(locale, messages.me1f5c62bd1d6, "new window")}`}>
        {identity.fandom.mark && <svg className={styles.fandomMark} viewBox="550 350 770 260" aria-hidden="true"><image href={identity.fandom.mark} width="1664" height="1368" /></svg>}
        <span>{identity.fandom.name}<span className={styles.fandomKorean}>{identity.fandom.ko}</span></span>
        <ArrowUpRight className={styles.fandomExternal} aria-hidden="true" />
      </a></dd>
    </dl>}
  </div>;
}
