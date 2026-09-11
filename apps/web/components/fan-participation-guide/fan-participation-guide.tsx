import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, BadgeCheck, BookOpen, CalendarDays, MessageCircle } from "lucide-react";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FocusFlowHeader } from "../fan-shell/focus-flow-header";
import { FanLanguageSwitch } from "../fan-shell/fan-language-switch";
import type { GuideImages } from "@/server/media/guide-images";
import { CreatorAvatar } from "../fan-ui/creator-avatar";
import { EventPhoto } from "../fan-ui/event-photo";
import { CreatorImage } from "../fan-ui/creator-image";
import { elinaFanGuideContent } from "../elina-fan-guide/content";
import { ifewEventBanner, ifewFanGuideContent, ifewLiveSlug, ifewTikTokEvent } from "../ifew-fan-guide/content";
import { ifewRafflesHref, ifewVerificationHref } from "@/features/live/domain/ifew-event";
import { elinaLiveHref, elinaRafflesHref, elinaVerificationHref } from "@/features/live/domain/elina-event";
import { SignupGuideLink, SignupGuideView } from "@/features/analytics/client/signup-guide-tracking";
import type { SignupAction, SignupGuide, SignupPlacement } from "@/features/analytics/domain/signup-funnel-event";
import styles from "./fan-participation-guide.module.css";

const actionTargets = (locale: FanLocale) => ({
  verify: elinaVerificationHref(locale) as Route,
  live: elinaLiveHref(locale) as Route,
  raffles: elinaRafflesHref(locale) as Route,
  my: `/my?locale=${locale}` as Route,
});

type GuideHref = Route | `#${string}` | `https://${string}`;

function ActionLink({ children, href, primary = false, guide, locale, placement }: {
  children: React.ReactNode; href: GuideHref; primary?: boolean;
  guide: SignupGuide; locale: FanLocale; placement: SignupPlacement;
}) {
  const action: SignupAction = href === "#steps" ? "steps" : href.startsWith("https://") ? "certifications"
    : href.startsWith("/my") ? "my" : href.includes("/verify") ? "verify"
      : href.includes("/raffles") ? "raffles" : "live";
  return (
    <SignupGuideLink className={`${styles.action} ${primary ? styles.primaryAction : ""}`} href={href}
      guide={guide} locale={locale} action={action} placement={placement}>
      {children}
      <ArrowRight aria-hidden="true" size={17} />
    </SignupGuideLink>
  );
}

export function FanParticipationGuide({ locale, creator, images }: { locale: FanLocale; creator: "elina" | "ifew"; images: GuideImages }) {
  const t = creator === "elina" ? elinaFanGuideContent[locale] : ifewFanGuideContent[locale];
  const celebrity = images.celebrity;
  const href = creator === "elina" ? actionTargets(locale) : {
    verify: ifewVerificationHref(locale) as Route,
    live: `/live/${ifewLiveSlug}?locale=${locale}` as Route,
    certifications: ifewTikTokEvent,
    raffles: ifewRafflesHref(locale),
    my: `/my?locale=${locale}` as Route,
  } as const;
  const nextLocale = locale === "ko" ? "en" : "ko";
  const stepTargets: ReadonlyArray<ReadonlyArray<GuideHref>> = creator === "elina" ? [
    [href.verify],
    [href.live],
    [href.raffles],
    [`${href.live}#fan-code` as Route, href.raffles],
  ] : [
    [href.verify],
    [href.live, href.my],
    [`${href.live}#fan-code` as Route, ifewTikTokEvent],
    [href.raffles],
  ] as const;

  return (
    <div className={styles.page} lang={locale} data-fan-surface>
      <SignupGuideView guide={creator} locale={locale} />
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
            {"heroSchedule" in t ? <p className={styles.schedule}><CalendarDays aria-hidden="true" size={18} /><time dateTime={creator === "elina" ? "2026-09-18T20:30:00+09:00" : "2026-09-12T08:00:00+09:00"}>{t.heroSchedule}</time></p> : null}
            {creator === "elina" ? <p className={styles.prizeSummary}>{elinaFanGuideContent[locale].prizeSummary}</p> : null}
            <div className={styles.actions}>
              <ActionLink guide={creator} locale={locale} placement="hero" href={creator === "elina" ? href.verify : "#steps"} primary>{t.howToJoin}</ActionLink>
              <ActionLink guide={creator} locale={locale} placement="hero" href={href.raffles}>{t.viewPrizes}</ActionLink>
            </div>
            <p className={styles.note}>{t.heroNote}</p>
          </div>
          {creator === "elina" ? (
            celebrity ? <CreatorImage className={styles.heroImage} slug={celebrity.slug} src={celebrity.image.url} photos={celebrity.image.photos} position={celebrity.image.position} presentation="editorial" locale={locale} alt={t.imageAlt} width={580} height={560} sizes="(max-width: 959px) calc(100vw - 40px), (max-width: 1199px) 48vw, 580px" priority /> : null
          ) : (
            <div className={styles.eventImage}><EventPhoto photos={images.eventPhotos} src={ifewEventBanner} alt={ifewFanGuideContent[locale].eventImageAlt} locale={locale} surface="poster" sizes="(max-width: 959px) calc(100vw - 40px), (max-width: 1199px) 48vw, 580px" priority /></div>
          )}
        </section>

        <ol className={styles.stageNav} aria-label={locale === "ko" ? "참여 순서" : "Participation steps"}>
          {t.stages.map((stage, index) => <li key={stage}><span>0{index + 1}</span>{stage}</li>)}
        </ol>

        <div className={styles.steps} id="steps">
          {t.steps.map((step, index) => (
            <section className={styles.step} id={index === (creator === "elina" ? 2 : 3) ? "prizes" : undefined} key={step.label} aria-labelledby={`guide-step-${index + 1}`}>
              <div className={styles.visual}>
                {index === 0 ? (
                  <Image className={styles.passport} src="/images/guest-home/passport-open-blank-9-transparent.png" alt="Fan Passport" width={460} height={307} />
                ) : index === 1 ? (
                  <div className={styles.liveCard}>
                    <div className={styles.liveTitle}>
                      {celebrity ? <CreatorAvatar slug={celebrity.slug} src={celebrity.image.url} photos={celebrity.image.photos} position={celebrity.image.position} size={{ mobile: 40, desktop: 48 }} /> : null}
                      <strong>{t.liveCard.title}</strong>
                    </div>
                    <p>{t.liveCard.flow}</p>
                    <div className={styles.code}><small>{t.liveCard.code}</small>{"value" in t.liveCard ? <span>{t.liveCard.value}</span> : <span aria-hidden="true">— &nbsp; — &nbsp; — &nbsp; — &nbsp; — &nbsp; —</span>}</div>
                  </div>
                ) : index === (creator === "elina" ? 3 : 2) ? (
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
                    <ActionLink guide={creator} locale={locale} placement="step" href={stepTargets[index][actionIndex]}>{label}</ActionLink>
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
          <ActionLink guide={creator} locale={locale} placement="history" href={href.my}>{t.historyAction}</ActionLink>
        </section>

        <section className={styles.faq} aria-labelledby="guide-faq-title">
          <h2 id="guide-faq-title">{t.faqTitle}</h2>
          <div>{t.faqs.map(([question, answer]) => <article key={question}><h3>{question}</h3><p>{answer}</p></article>)}</div>
        </section>

        <section className={styles.closing} aria-labelledby="guide-closing-title">
          <h2 id="guide-closing-title">{t.closingTitle}</h2>
          <ActionLink guide={creator} locale={locale} placement="closing" href={creator === "elina" ? href.verify : href.live}>{t.closingAction}</ActionLink>
        </section>
      </main>

    </div>
  );
}
