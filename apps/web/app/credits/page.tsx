import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";

import styles from "./credits.module.css";
import { katseyeAttribution } from "./katseye-attribution";

export const metadata: Metadata = {
  title: "이미지 출처 | ByUs",
  description: "ByUs에서 사용하는 공개 이미지의 저작자와 라이선스 안내",
};

const copy = {
  ko: {
    back: "홈으로 돌아가기",
    home: "홈",
    eyebrow: "ByUs 이미지 출처",
    title: "이미지 출처",
    description: "ByUs는 아래 공개 이미지를 Creative Commons 라이선스 조건에 따라 사용합니다. 화면 비율에 맞춰 자르기, 크기 조정, WebP 변환을 적용했으며 원본의 인물이나 장면을 합성하지 않았습니다.",
    author: "저작자",
    license: "라이선스",
    source: "원본",
    changes: "변경 사항",
    openLicense: "Creative Commons 저작자표시 4.0 라이선스 열기, 새 창",
    openSource: "Wikimedia Commons 원본 열기, 새 창",
    sourceLabel: "Wikimedia Commons",
  },
  en: {
    back: "Back to home",
    home: "Home",
    eyebrow: "ByUs image credits",
    title: "Image credits",
    description: "ByUs uses the public images below under the Creative Commons license. We cropped, resized, and converted the originals to WebP for each layout without compositing people or scenes.",
    author: "Author",
    license: "License",
    source: "Source",
    changes: "Changes",
    openLicense: "Open the Creative Commons Attribution 4.0 license, new window",
    openSource: "Open the Wikimedia Commons source, new window",
    sourceLabel: "Wikimedia Commons",
  },
} as const;

function normalizeLocale(value: string | string[] | undefined): FanLocale {
  return value === "en" ? "en" : "ko";
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string | string[] }>;
}) {
  const locale = normalizeLocale((await searchParams).locale);
  const t = copy[locale];

  return (
    <FocusFlowFrame
      locale={locale}
      mainId="image-credits-main"
      showFooter
      headerActions={
        <Link className={styles.homeLink} href={`/?locale=${locale}`} aria-label={t.back}>
          <ArrowLeft aria-hidden="true" />
          {t.home}
        </Link>
      }
    >
      <main className={styles.main} id="image-credits-main" tabIndex={-1}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className={styles.description}>{t.description}</p>
        </header>

        <div className={styles.sources}>
          {katseyeAttribution.sources.map((source) => (
            <article className={styles.source} key={source.title}>
              <div className={styles.preview}>
                <Image
                  alt={`${source.title} — ${source.author}`}
                  fill
                  sizes="(max-width: 767px) calc(100vw - 40px), 240px"
                  src={source.derivatives[0].path}
                />
              </div>
              <div className={styles.details}>
                <h2>{source.title}</h2>
                <dl>
                  <dt>{t.author}</dt>
                  <dd>{source.author}</dd>
                  <dt>{t.license}</dt>
                  <dd>
                    <a aria-label={t.openLicense} href={katseyeAttribution.license.url} rel="noreferrer" target="_blank">
                      {katseyeAttribution.license.shortName}
                    </a>
                  </dd>
                  <dt>{t.source}</dt>
                  <dd>
                    <a aria-label={t.openSource} href={source.filePage} rel="noreferrer" target="_blank">
                      {t.sourceLabel}
                    </a>
                  </dd>
                  <dt>{t.changes}</dt>
                  <dd>
                    {source.derivatives
                      .map((derivative) => derivative.changes)
                      .filter((change, index, changes) => changes.indexOf(change) === index)
                      .join("; ")}
                  </dd>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </main>
    </FocusFlowFrame>
  );
}
