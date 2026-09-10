import Image from "next/image";
import {
  ArrowDown,
  Check,
  Clapperboard,
  ClipboardCheck,
  MapPin,
  UsersRound,
} from "lucide-react";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FocusFlowHeader } from "../fan-shell/focus-flow-header";
import { FanLanguageSwitch } from "../fan-shell/fan-language-switch";
import { FanWordmarkLink } from "../fan-shell/fan-wordmark-link";
import { fanmeetingContent } from "./content";
import { FanmeetingInquiryProvider, InquiryButton } from "./inquiry-dialog";
import styles from "./us-fanmeetings-page.module.css";

export const FANMEETING_EMAIL = "biz@sallylab.io";
const serviceIcons = [MapPin, ClipboardCheck, Clapperboard, UsersRound];
const visualServiceIcons = [MapPin, Clapperboard, UsersRound];

function InquiryLink({ children }: { children: React.ReactNode }) {
  return (
    <InquiryButton className={styles.cta}>{children}</InquiryButton>
  );
}

function SectionHeading({
  id,
  eyebrow,
  children,
}: {
  id: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <header className={styles.sectionHeading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={id}>{children}</h2>
    </header>
  );
}

export function UsFanmeetingsPage({ locale }: { locale: FanLocale }) {
  const t = fanmeetingContent[locale];
  const nextLocale = locale === "ko" ? "en" : "ko";
  return (
    <FanmeetingInquiryProvider locale={locale}>
    <div className={styles.page} lang={locale} data-fan-surface>
      <FocusFlowHeader
        locale={locale}
        mainId="fanmeeting-main"
        innerClassName={styles.headerInner}
      >
        <FanLanguageSwitch
          locale={locale}
          href={`/pages/us-fanmeetings?locale=${nextLocale}`}
          ariaLabel={locale === "ko" ? "Switch to English" : "한국어로 보기"}
        />
      </FocusFlowHeader>
      <main className={styles.main} id="fanmeeting-main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="fanmeeting-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              ByUs <span aria-hidden="true">/</span> U.S. FAN MEETINGS
            </p>
            <h1 id="fanmeeting-title">{t.hero}</h1>
            <p className={styles.description}>{t.desc}</p>
            <InquiryLink>{t.cta}</InquiryLink>
            <a className={styles.supportLink} href="#support">
              {t.scope}
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <figure className={styles.heroVisual}>
            <figcaption className={styles.visualTitle}>
              {t.visualTitle}
            </figcaption>
            <div className={styles.stageScene} aria-hidden="true">
              <div className={styles.stageLights}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.stageBackdrop}>
                <Image
                  src="/images/guest-home/byus-wordmark.svg"
                  alt=""
                  width={110}
                  height={45}
                />
                <span>FANS. IN PERSON.</span>
              </div>
              <div className={styles.stageFloor} />
              <div className={styles.fanRow}>
                {Array.from({ length: 7 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            </div>
            <ul className={styles.visualServices}>
              {t.visualServices.map((label, index) => {
                const Icon = visualServiceIcons[index];
                return (
                  <li key={label}>
                    <Icon size={20} aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                );
              })}
            </ul>
          </figure>
        </section>
        <p className={styles.audience}>{t.audience}</p>

        <section className={styles.section} aria-labelledby="partners-title">
          <SectionHeading id="partners-title" eyebrow="01 / TOGETHER">
            {t.rolesTitle}
          </SectionHeading>
          <div className={styles.partnerGrid}>
            {[
              {
                id: "engagement",
                title: t.roleA,
                description: t.roleADesc,
                items: t.a,
                icon: UsersRound,
              },
              {
                id: "operations",
                title: t.roleB,
                description: t.roleBDesc,
                items: t.b,
                icon: MapPin,
              },
            ].map((partner) => (
              <article
                className={`${styles.partnerCard} ${partner.id === "operations" ? styles.operationsCard : ""}`}
                key={partner.id}
              >
                <partner.icon
                  className={styles.partnerIcon}
                  size={28}
                  aria-hidden="true"
                />
                <div className={styles.partnerHeading}>
                  <h3>{partner.title}</h3>
                  <p>{partner.description}</p>
                </div>
                <ul>
                  {partner.items.map((item) => (
                    <li key={item}>
                      <Check size={18} aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="journey-title">
          <SectionHeading id="journey-title" eyebrow="02 / THE FAN JOURNEY">
            {t.journey}
          </SectionHeading>
          <div className={styles.journeyGrid}>
            {t.stages.map(([name, title, activities]) => (
              <article className={styles.stage} key={name}>
                <p className={styles.eyebrow}>{name}</p>
                <h3>{title}</h3>
                <p>{activities}</p>
              </article>
            ))}
          </div>
          <div className={styles.passportBand}>
            <Image
              src="/images/guest-home/passport-open-blank-9-transparent.png"
              alt="Fan Passport"
              width={240}
              height={160}
            />
            <div>
              <h3>
                {locale === "ko"
                  ? "팬이 쌓아가는 참여의 기록"
                  : "A record of every fan’s participation"}
              </h3>
              <p>
                {locale === "ko"
                  ? "Fan Passport에 쌓인 참여를 바탕으로\n다음 캠페인과 팬 경험을 함께 기획합니다."
                  : "Plan future campaigns and fan experiences\nwith participation recorded in Fan Passport."}
              </p>
            </div>
          </div>
        </section>

        <section
          className={styles.section}
          id="support"
          aria-labelledby="support-title"
        >
          <SectionHeading id="support-title" eyebrow="03 / U.S. SUPPORT">
            {t.support}
          </SectionHeading>
          <p className={styles.description}>{t.supportDesc}</p>
          <div className={styles.serviceGrid}>
            {t.services.map(([, title, description], index) => {
              const Icon = serviceIcons[index];
              return (
                <article className={styles.service} key={title}>
                  <Icon size={26} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="process-title">
          <SectionHeading id="process-title" eyebrow="04 / GET STARTED">
            {t.process}
          </SectionHeading>
          <ol className={styles.processGrid}>
            {t.steps.map(([title, description], index) => (
              <li key={title}>
                <span className={styles.stepNumber} aria-hidden="true">
                  0{index + 1}
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="faq-title">
          <SectionHeading id="faq-title" eyebrow="05 / FAQ">
            {t.faqTitle}
          </SectionHeading>
          <div>
            {t.faqs.map(([question, answer]) => (
              <article className={styles.faq} key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.inquiry} aria-labelledby="inquiry-title">
          <div className={styles.inquiryMessage}>
            <p className={styles.eyebrow}>LET’S MEET THE FANS.</p>
            <h2 id="inquiry-title">{t.close}</h2>
            <p>{t.closeDesc}</p>
          </div>
          <div className={styles.contact}>
            <InquiryButton className={styles.email}>
              {FANMEETING_EMAIL}
            </InquiryButton>
            <InquiryLink>{t.email}</InquiryLink>
            <p>{t.note}</p>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <FanWordmarkLink locale={locale} />
          <p>{t.footer}</p>
        </div>
      </footer>
    </div>
    </FanmeetingInquiryProvider>
  );
}
