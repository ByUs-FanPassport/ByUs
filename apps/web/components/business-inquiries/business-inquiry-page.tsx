import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, BadgeCheck, Building2, Check, Gift, Heart, Megaphone, Radio, ShoppingBag, Sparkles, UsersRound } from "lucide-react";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FocusFlowHeader } from "../fan-shell/focus-flow-header";
import { FanLanguageSwitch } from "../fan-shell/fan-language-switch";
import { BusinessInquiryProvider, InquiryButton } from "../us-fanmeetings/inquiry-dialog";
import { businessPageContent, businessPagePaths, type BusinessPageKind } from "./content";
import styles from "../us-fanmeetings/us-fanmeetings-page.module.css";
import local from "./business-inquiry-page.module.css";

const icons = {
  creator: [UsersRound, Radio, BadgeCheck, Gift],
  partner: [ShoppingBag, Radio, Sparkles, Megaphone, Gift],
};
const partnerIcons = [Building2, Sparkles, Heart];

export function BusinessInquiryPage({ kind, locale }: { kind: BusinessPageKind; locale: FanLocale }) {
  const t = businessPageContent[kind][locale];
  const nextLocale = locale === "ko" ? "en" : "ko";
  const relatedPath = kind === "creator" ? businessPagePaths.partner : "/pages/us-fanmeetings";
  return (
    <BusinessInquiryProvider key={`${kind}-${locale}`} kind={kind} locale={locale}>
      <div className={`${styles.page} ${local.page}`} lang={locale} data-fan-surface>
        <FocusFlowHeader locale={locale} mainId={`${kind}-main`} innerClassName={styles.headerInner}>
          <FanLanguageSwitch locale={locale} href={`${businessPagePaths[kind]}?locale=${nextLocale}`} ariaLabel={locale === "ko" ? "Switch to English" : "한국어로 보기"} />
        </FocusFlowHeader>
        <main className={styles.main} id={`${kind}-main`} tabIndex={-1}>
          <section className={styles.hero} aria-labelledby={`${kind}-title`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>ByUs <span aria-hidden="true">/</span> {t.eyebrow}</p>
              <h1 id={`${kind}-title`}>{t.hero}</h1>
              <p className={styles.description}>{t.description}</p>
              <InquiryButton className={styles.cta}>{t.cta}</InquiryButton>
              <a className={styles.supportLink} href="#support">{t.scope}<ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <figure className={`${styles.heroVisual} ${local.visual}`}>
              <figcaption className={styles.visualTitle}>{t.visualTitle}</figcaption>
              {kind === "creator" ? (
                <>
                  <Image className={local.passport} src="/images/guest-home/passport-open-blank-9-transparent.png" alt="" width={600} height={400} priority sizes="(max-width: 767px) 85vw, 420px" />
                  <ul className={local.visualLabels}>{t.visualLabels.map((label) => <li key={label}><Check size={16} aria-hidden="true" />{label}</li>)}</ul>
                </>
              ) : (
                <div className={local.partnerVisual}>
                  <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={128} height={52} />
                  <ul>{t.visualLabels.map((label, index) => {
                    const Icon = partnerIcons[index];
                    return <li key={label}><Icon size={24} aria-hidden="true" /><span>{label}</span></li>;
                  })}</ul>
                </div>
              )}
            </figure>
          </section>
          <p className={styles.audience}>{t.audience}</p>

          <section className={styles.section} id="support" aria-labelledby="support-title">
            <header className={styles.sectionHeading}><p className={styles.eyebrow}>01 / {kind === "creator" ? "WITH YOUR FANS" : "WORK TOGETHER"}</p><h2 id="support-title">{t.supportTitle}</h2></header>
            <p className={styles.description}>{t.supportDescription}</p>
            <div className={`${styles.serviceGrid} ${kind === "partner" ? local.partnerServices : ""}`}>
              {t.services.map((service, index) => {
                const Icon = icons[kind][index];
                return <article className={styles.service} key={service.title}><Icon size={26} aria-hidden="true" /><h3>{service.title}</h3><p>{service.description}</p></article>;
              })}
            </div>
            <Link className={local.textLink} href={`/guide?locale=${locale}`}>{t.guide}<ArrowRight size={18} aria-hidden="true" /></Link>
          </section>

          <section className={styles.section} aria-labelledby="process-title">
            <header className={styles.sectionHeading}><p className={styles.eyebrow}>02 / GET STARTED</p><h2 id="process-title">{t.processTitle}</h2></header>
            <ol className={styles.processGrid}>{t.steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber} aria-hidden="true">0{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol>
          </section>

          <section className={local.prepare} aria-labelledby="prepare-title">
            <div className={styles.sectionHeading}><p className={styles.eyebrow}>03 / YOUR IDEAS</p><h2 id="prepare-title">{t.prepareTitle}</h2><p className={styles.description}>{t.prepareDescription}</p></div>
            <ul>{t.prepare.map((item) => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
          </section>

          <section className={styles.section} aria-labelledby="faq-title">
            <header className={styles.sectionHeading}><p className={styles.eyebrow}>04 / FAQ</p><h2 id="faq-title">{t.faqTitle}</h2></header>
            <div>{t.faqs.map((faq) => <article className={styles.faq} key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></article>)}</div>
          </section>

          <section className={styles.inquiry} aria-labelledby="inquiry-title">
            <div className={styles.inquiryMessage}><p className={styles.eyebrow}>LET’S TALK.</p><h2 id="inquiry-title">{t.closeTitle}</h2><p>{t.closeDescription}</p></div>
            <div className={styles.contact}><InquiryButton className={styles.email}>biz@sallylab.io</InquiryButton><InquiryButton className={local.secondaryCta}>{t.cta}</InquiryButton></div>
          </section>
          <Link className={local.related} href={`${relatedPath}?locale=${locale}`}>{t.related}<ArrowRight size={18} aria-hidden="true" /></Link>
        </main>
      </div>
    </BusinessInquiryProvider>
  );
}
