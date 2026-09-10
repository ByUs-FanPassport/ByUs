import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, BadgeCheck, BookOpen, CalendarDays, MessageCircle } from "lucide-react";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FocusFlowHeader } from "../fan-shell/focus-flow-header";
import { FanLanguageSwitch } from "../fan-shell/fan-language-switch";
import { FanWordmarkLink } from "../fan-shell/fan-wordmark-link";
import { CreatorImage } from "../fan-ui/creator-image";
import { elinaFanGuideContent } from "../elina-fan-guide/content";
import { ifewBenefitId, ifewEventBanner, ifewFanGuideContent, ifewGuideImage, ifewLiveSlug, ifewTikTokEvent } from "../ifew-fan-guide/content";
import { ifewVerificationHref } from "@/features/live/domain/ifew-event";
import styles from "./fan-participation-guide.module.css";

const actionTargets = (locale: FanLocale) => ({
  verify: `/c/elina/verify?locale=${locale}` as Route,
  live: `/c/elina?tab=live&locale=${locale}#celebrity-content` as Route,
  certifications:
    `/c/elina?tab=certifications&locale=${locale}#celebrity-content` as Route,
  raffles: `/c/elina?tab=raffles&locale=${locale}#celebrity-content` as Route,
  my: `/my?locale=${locale}` as Route,
});

type GuideHref = Route | `#${string}` | `https://${string}`;

function ActionLink({ children, href, primary = false }: { children: React.ReactNode; href: GuideHref; primary?: boolean }) {
  return (
    <Link className={`${styles.action} ${primary ? styles.primaryAction : ""}`} href={href}>
      {children}
      <ArrowRight aria-hidden="true" size={17} />
    </Link>
  );
}

export function FanParticipationGuide({ locale, creator }: { locale: FanLocale; creator: "elina" | "ifew" }) {
  const t = creator === "elina" ? elinaFanGuideContent[locale] : ifewFanGuideContent[locale];
  const image = creator === "elina" ? "/images/home-entry/elina.jpg" : ifewGuideImage;
  const href = creator === "elina" ? actionTargets(locale) : {
    verify: ifewVerificationHref(locale) as Route,
    live: `/live/${ifewLiveSlug}?locale=${locale}` as Route,
    certifications: ifewTikTokEvent,
    raffles: `/benefits/${ifewBenefitId}?locale=${locale}` as Route,
    my: `/my?locale=${locale}` as Route,
  } as const;
  const nextLocale = locale === "ko" ? "en" : "ko";
  const stepTargets: ReadonlyArray<ReadonlyArray<GuideHref>> = [
    [href.verify],
    [href.live, creator === "elina" ? href.live : href.my],
    creator === "elina" ? [href.live, href.certifications] : [`${href.live}#fan-code` as Route, ifewTikTokEvent],
    [href.raffles],
  ] as const;

  return (
    <div className={styles.page} lang={locale} data-fan-surface>
      <FocusFlowHeader locale={locale} mainId={`${creator}-guide-main`} innerClassName={styles.headerInner}>
        <nav className={styles.navigation} aria-label={locale === "ko" ? "주요 메뉴" : "Primary navigation"}>
          <Link href={`/?locale=${locale}` as Route}>HOME</Link>
          <Link href={`/live?locale=${locale}` as Route}>LIVE</Link>
          <Link href={`/celebrities?locale=${locale}` as Route}>{locale === "ko" ? "최애" : "Favorites"}</Link>
          <Link href={href.my}>MY</Link>
        </nav>
        <FanLanguageSwitch
          locale={locale}
          href={`/pages/${creator}-fan-guide?locale=${nextLocale}` as Route}
          ariaLabel={locale === "ko" ? "Switch to English" : "한국어로 보기"}
        />
      </FocusFlowHeader>

      <main className={styles.main} id={`${creator}-guide-main`} tabIndex={-1}>
        <section className={`${styles.hero} ${creator === "ifew" ? styles.eventHero : ""}`} aria-labelledby={`${creator}-guide-title`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>BYUS GUIDE&nbsp;&nbsp;/&nbsp;&nbsp;{creator.toUpperCase()}</p>
            <h1 id={`${creator}-guide-title`}>{t.heroTitle}</h1>
            <p className={styles.heroDescription}>{t.heroDescription}</p>
            {"heroSchedule" in t ? <p className={styles.schedule}><CalendarDays aria-hidden="true" size={18} /><time dateTime="2026-09-12T08:00:00+09:00">{t.heroSchedule}</time></p> : null}
            <div className={styles.actions}>
              <ActionLink href="#steps" primary>{t.howToJoin}</ActionLink>
              <ActionLink href="#prizes">{t.viewPrizes}</ActionLink>
            </div>
            <p className={styles.note}>{t.heroNote}</p>
          </div>
          {creator === "elina" ? (
            <Image className={styles.heroImage} src={image} alt={t.imageAlt} width={580} height={560} sizes="(max-width: 959px) calc(100vw - 40px), (max-width: 1199px) 48vw, 580px" priority />
          ) : (
            <Image className={styles.eventImage} src={ifewEventBanner} alt={ifewFanGuideContent[locale].eventImageAlt} width={1774} height={887} sizes="(max-width: 959px) calc(100vw - 40px), (max-width: 1199px) 48vw, 580px" priority />
          )}
        </section>

        <ol className={styles.stageNav} aria-label={locale === "ko" ? "참여 순서" : "Participation steps"}>
          {t.stages.map((stage, index) => <li key={stage}><span>0{index + 1}</span>{stage}</li>)}
        </ol>

        <div className={styles.steps} id="steps">
          {t.steps.map((step, index) => (
            <section className={styles.step} id={index === 3 ? "prizes" : undefined} key={step.label} aria-labelledby={`guide-step-${index + 1}`}>
              <div className={styles.visual}>
                {index === 0 ? (
                  <Image className={styles.passport} src="/images/guest-home/passport-open-blank-9-transparent.png" alt="Fan Passport" width={460} height={307} />
                ) : index === 1 ? (
                  <div className={styles.liveCard}>
                    <div className={styles.liveTitle}>
                      {creator === "elina" ? <Image src={image} alt="" width={48} height={48} /> : <CreatorImage slug="ifewknow" src={image} presentation="collection" alt="" width={48} height={48} sizes="48px" />}
                      <strong>{t.liveCard.title}</strong>
                    </div>
                    <p>{t.liveCard.flow}</p>
                    <div className={styles.code}><small>{t.liveCard.code}</small>{"value" in t.liveCard ? <span>{t.liveCard.value}</span> : <span aria-hidden="true">— &nbsp; — &nbsp; — &nbsp; — &nbsp; — &nbsp; —</span>}</div>
                  </div>
                ) : index === 2 ? (
                  <div className={styles.missionCards}>
                    {t.missionCards.map(([title, caption], cardIndex) => {
                      const Icon = cardIndex === 0 ? MessageCircle : creator === "elina" ? BadgeCheck : CalendarDays;
                      return <div key={title}><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{caption}</small></span></div>;
                    })}
                  </div>
                ) : (
                  <Image className={styles.prizeImage} src="/images/guest-home/banksy-exhibition-campaign.webp" alt={t.prizeAlt} width={560} height={340} />
                )}
              </div>
              <div className={styles.stepCopy}>
                <p className={styles.eyebrow}>{step.label}</p>
                <h2 id={`guide-step-${index + 1}`}>{step.title}</h2>
                <p className={styles.stepBody}>{step.body}</p>
                {step.actions.map((label, actionIndex) => (
                  <div className={styles.stepActionRow} key={label}>
                    <ActionLink href={stepTargets[index][actionIndex]}>{label}</ActionLink>
                    {actionIndex === 0 && "note" in step && step.note ? <p className={styles.note}>{step.note}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className={styles.history} aria-labelledby="history-title">
          <BookOpen aria-hidden="true" />
          <div><h2 id="history-title">{t.historyTitle}</h2><p>{t.historyBody}</p></div>
          <ActionLink href={href.my}>{t.historyAction}</ActionLink>
        </section>

        <section className={styles.faq} aria-labelledby="guide-faq-title">
          <h2 id="guide-faq-title">{t.faqTitle}</h2>
          <div>{t.faqs.map(([question, answer]) => <article key={question}><h3>{question}</h3><p>{answer}</p></article>)}</div>
        </section>

        <section className={styles.closing} aria-labelledby="guide-closing-title">
          <h2 id="guide-closing-title">{t.closingTitle}</h2>
          <ActionLink href={creator === "elina" ? href.verify : href.live}>{t.closingAction}</ActionLink>
        </section>
      </main>

      <footer className={styles.footer}><div className={styles.footerInner}><FanWordmarkLink locale={locale} /><p>{t.footer}</p></div></footer>
    </div>
  );
}
