import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Book, ChevronRight, Clock, Play, Radio } from "./icons";
import type { PublishedCelebrity } from "./public-celebrity-fixtures";
import styles from "./celebrity-fan-page.module.css";

export function CelebrityFanPage({ celebrity }: { celebrity: PublishedCelebrity }) {
  const passportHref = `/login?returnTo=${encodeURIComponent(`/c/${celebrity.slug}/verify`)}&intent=passport`;
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link className={styles.brand} href="/" aria-label="ByUs 홈"><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority /></Link><a className={styles.directoryLink} href="/celebrities">셀럽 전체 보기 <ChevronRight /></a></header>
      <section className={styles.hero} aria-labelledby="celebrity-heading">
        <Image src={celebrity.image} alt={celebrity.imageAlt} fill sizes="(min-width: 1024px) 1200px, 100vw" priority style={{ objectPosition: celebrity.imagePosition }} />
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.heroCopy}><p>OFFICIAL CELEBRITY</p><h1 id="celebrity-heading">{celebrity.name}</h1><span>{celebrity.summary}</span></div>
      </section>
      <div className={styles.sections}>
        {celebrity.upcomingLive ? <section className={styles.liveSection} aria-labelledby="live-title"><div className={styles.liveCopy}><p><Radio /> UPCOMING LIVE</p><h2 id="live-title">{celebrity.upcomingLive.title}</h2><span><Clock /> {celebrity.upcomingLive.schedule}</span></div><a className={styles.liveAction} href={`/live/${celebrity.upcomingLive.slug}`}><span><Play /> LIVE 자세히 보기</span><ArrowRight /></a></section> : <section className={styles.noLive} aria-labelledby="no-live-title"><h2 id="no-live-title">예정된 LIVE가 아직 없어요.</h2><p>새로운 일정이 공개되면 이 페이지에서 바로 확인할 수 있어요.</p></section>}
        <section className={styles.passportSection} aria-labelledby="passport-title"><div className={styles.passportImage}><Image src="/images/guest-home/passport-open-empty.png" alt="모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport" width={1536} height={1024} /></div><div className={styles.passportCopy}><Book /><h2 id="passport-title">{celebrity.name} Fan Passport</h2><p>팬 인증을 완료하고 함께한 LIVE 순간을 하나씩 기록해 보세요.</p><a href={passportHref}><span>Fan Passport 발급받기</span><ArrowRight /></a></div></section>
      </div>
    </main>
  );
}
