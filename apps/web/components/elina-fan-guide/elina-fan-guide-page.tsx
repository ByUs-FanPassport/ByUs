import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, BadgeCheck, BookOpen, MessageCircle } from "lucide-react";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FocusFlowHeader } from "../fan-shell/focus-flow-header";
import { FanWordmarkLink } from "../fan-shell/fan-wordmark-link";
import { elinaFanGuideContent } from "./content";
import styles from "./elina-fan-guide-page.module.css";

const actionTargets = (locale: FanLocale) => ({
  verify: `/c/elina/verify?locale=${locale}` as Route,
  live: `/c/elina?tab=live&locale=${locale}#celebrity-content` as Route,
  certifications:
    `/c/elina?tab=certifications&locale=${locale}#celebrity-content` as Route,
  raffles: `/c/elina?tab=raffles&locale=${locale}#celebrity-content` as Route,
  my: `/my?locale=${locale}` as Route,
});

function ActionLink({ children, href, primary = false }: { children: React.ReactNode; href: Route | `#${string}`; primary?: boolean }) {
  return (
    <Link className={`${styles.action} ${primary ? styles.primaryAction : ""}`} href={href}>
      {children}
      <ArrowRight aria-hidden="true" size={17} />
    </Link>
  );
}

export function ElinaFanGuidePage({ locale }: { locale: FanLocale }) {
  const t = elinaFanGuideContent[locale];
  const href = actionTargets(locale);
  const nextLocale = locale === "ko" ? "en" : "ko";
  const stepTargets = [
    [href.verify],
    [href.live, href.live],
    [href.live, href.certifications],
    [href.raffles],
  ] as const;

  return (
    <div className={styles.page} lang={locale} data-fan-surface>
      <FocusFlowHeader locale={locale} mainId="elina-guide-main" innerClassName={styles.headerInner}>
        <nav className={styles.navigation} aria-label={locale === "ko" ? "주요 메뉴" : "Primary navigation"}>
          <Link href={`/?locale=${locale}` as Route}>HOME</Link>
          <Link href={`/live?locale=${locale}` as Route}>LIVE</Link>
          <Link href={`/celebrities?locale=${locale}` as Route}>{locale === "ko" ? "최애" : "Favorites"}</Link>
          <Link href={href.my}>MY</Link>
        </nav>
        <Link className={styles.language} href={`/pages/elina-fan-guide?locale=${nextLocale}` as Route} hrefLang={nextLocale} aria-label={locale === "ko" ? "Switch to English" : "한국어로 보기"}>
          {locale === "ko" ? "한국어 / EN" : "KO / English"}
        </Link>
      </FocusFlowHeader>

      <main className={styles.main} id="elina-guide-main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="elina-guide-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>BYUS GUIDE&nbsp;&nbsp;/&nbsp;&nbsp;ELINA</p>
            <h1 id="elina-guide-title">{t.heroTitle}</h1>
            <p className={styles.heroDescription}>{t.heroDescription}</p>
            <div className={styles.actions}>
              <ActionLink href="#steps" primary>{t.howToJoin}</ActionLink>
              <ActionLink href="#prizes">{t.viewPrizes}</ActionLink>
            </div>
            <p className={styles.note}>{t.heroNote}</p>
          </div>
          <Image className={styles.heroImage} src="/images/home-entry/elina.jpg" alt={t.imageAlt} width={580} height={560} priority />
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
                    <div className={styles.liveTitle}><Image src="/images/home-entry/elina.jpg" alt="" width={48} height={48} /><strong>{t.liveCard.title}</strong></div>
                    <p>{t.liveCard.flow}</p>
                    <div className={styles.code}><small>{t.liveCard.code}</small><span aria-hidden="true">— &nbsp; — &nbsp; — &nbsp; — &nbsp; — &nbsp; —</span></div>
                  </div>
                ) : index === 2 ? (
                  <div className={styles.missionCards}>
                    {t.missionCards.map(([title, caption], cardIndex) => {
                      const Icon = cardIndex === 0 ? MessageCircle : BadgeCheck;
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
          <ActionLink href={href.verify}>{t.closingAction}</ActionLink>
        </section>
      </main>

      <footer className={styles.footer}><div className={styles.footerInner}><FanWordmarkLink locale={locale} /><p>{t.footer}</p></div></footer>
    </div>
  );
}
