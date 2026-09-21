'use client';

import { messages as localizedMessages } from "@/i18n/catalogs/features__live__ui__attendance-spotlight";
import { translate } from "@/i18n/messages";

import type { AppLocale } from "@/i18n/locales";
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight, Clock3, Radio, Sparkles, TicketCheck } from 'lucide-react';
import { useId } from 'react';
import type { LiveLocale } from '../domain/live-event';
import styles from './attendance-spotlight.module.css';

export function AttendanceSpotlight({ locale, closesAt, href, onClick }: { locale: AppLocale; closesAt: string; href: string; onClick?: () => void }) {
  const id = useId();
  const ko = locale === 'ko';
  const deadline = new Intl.DateTimeFormat(locale, { calendar: "gregory", timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(closesAt));
  return <section className={styles.spotlight} aria-labelledby={id}>
    <div className={styles.ticket} aria-hidden="true"><Sparkles className={styles.sparkles} /><TicketCheck /><span>CHECK IN</span><div className={styles.ticketCode}><i /><i /><i /><i /></div></div>
    <div className={styles.copy}>
      <p className={styles.badge}><Radio aria-hidden="true" />{ko ? '지금 출석코드 입력 가능' : translate(locale, localizedMessages.m6c981491f2d7, "CHECK-IN IS OPEN")}</p>
      <h2 id={id}>{ko ? <>오늘의 LIVE,<br />내 출석을 남겨요.</> : locale === "en" ? <>Here for the LIVE?<br />Make it official.</> : translate(locale, localizedMessages.m1a8044462ad1, "Here for the LIVE? Make it official.")}</h2>
      <p className={styles.description}>{ko ? '방송에서 공개된 Fan Code를 입력해 주세요.' : translate(locale, localizedMessages.m20ade23c673e, "Enter the Fan Code shared during the broadcast.")}</p>
      <p className={styles.deadline}><Clock3 aria-hidden="true" /><time dateTime={closesAt}>{deadline} KST</time>{ko ? '까지' : translate(locale, localizedMessages.m387239bdda6b, " · Closes")}</p>
    </div>
    <div className={styles.actionArea}>
      <Link className={styles.action} href={href as Route} onClick={onClick}>{ko ? '출석코드 입력하기' : translate(locale, localizedMessages.mc3ee95588d2b, "Enter Fan Code")}<ArrowUpRight aria-hidden="true" /></Link>
      <span>{ko ? 'Fan Passport가 있으면 예약 없이 참여 가능' : translate(locale, localizedMessages.mc708ece152e0, "No reservation needed with a Fan Passport")}</span>
    </div>
  </section>;
}
