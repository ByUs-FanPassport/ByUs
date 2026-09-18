'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight, Clock3, Radio, Sparkles, TicketCheck } from 'lucide-react';
import { useId } from 'react';
import type { LiveLocale } from '../domain/live-event';
import styles from './attendance-spotlight.module.css';

export function AttendanceSpotlight({ locale, closesAt, href, onClick }: { locale: LiveLocale; closesAt: string; href: string; onClick?: () => void }) {
  const id = useId();
  const ko = locale === 'ko';
  const deadline = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(closesAt));
  return <section className={styles.spotlight} aria-labelledby={id}>
    <div className={styles.ticket} aria-hidden="true"><Sparkles className={styles.sparkles} /><TicketCheck /><span>CHECK IN</span><div className={styles.ticketCode}><i /><i /><i /><i /></div></div>
    <div className={styles.copy}>
      <p className={styles.badge}><Radio aria-hidden="true" />{ko ? '지금 출석코드 입력 가능' : 'CHECK-IN IS OPEN'}</p>
      <h2 id={id}>{ko ? <>오늘의 LIVE,<br />내 출석을 남겨요.</> : <>Here for the LIVE?<br />Make it official.</>}</h2>
      <p className={styles.description}>{ko ? '방송에서 공개된 Fan Code를 입력해 주세요.' : 'Enter the Fan Code shared during the broadcast.'}</p>
      <p className={styles.deadline}><Clock3 aria-hidden="true" /><time dateTime={closesAt}>{deadline} KST</time>{ko ? '까지' : ' · Closes'}</p>
    </div>
    <div className={styles.actionArea}>
      <Link className={styles.action} href={href as Route} onClick={onClick}>{ko ? '출석코드 입력하기' : 'Enter Fan Code'}<ArrowUpRight aria-hidden="true" /></Link>
      <span>{ko ? 'Fan Passport가 있으면 예약 없이 참여 가능' : 'No reservation needed with a Fan Passport'}</span>
    </div>
  </section>;
}
