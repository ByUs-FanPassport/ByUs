import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "./icons";
import type { PublishedCelebrity } from "./public-celebrity-fixtures";
import styles from "./celebrity-directory.module.css";

export function CelebrityDirectory({ celebrities }: { celebrities: readonly PublishedCelebrity[] }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="ByUs 홈"><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority /></Link>
        <Link className={styles.homeLink} href="/">홈으로 <ChevronRight /></Link>
      </header>
      <section className={styles.content} aria-labelledby="directory-heading">
        <div className={styles.intro}><h1 id="directory-heading">당신의 최애</h1><p>ByUs에서 만날 수 있는 공식 셀럽을 둘러보세요.</p></div>
        {celebrities.length === 0 ? (
          <div className={styles.empty} role="status"><h2>지금 공개된 셀럽이 없어요.</h2><p>새로운 최애가 공개되면 이곳에서 바로 만날 수 있어요.</p><Link href="/">오늘의 LIVE로 돌아가기</Link></div>
        ) : (
          <div className={styles.grid} aria-label="공개 셀럽 목록">
            {celebrities.map((celebrity) => (
              <article className={styles.card} key={celebrity.slug}>
                <a className={styles.media} href={`/c/${celebrity.slug}`} aria-label={`${celebrity.name} 팬페이지 보기`}>
                  <Image src={celebrity.image} alt={celebrity.imageAlt} width={640} height={800} style={{ objectPosition: celebrity.imagePosition }} />
                </a>
                <div className={styles.cardBody}><div><h2>{celebrity.name}</h2><p>{celebrity.upcomingLive ? `${celebrity.upcomingLive.schedule} LIVE 예정` : "다음 LIVE 준비 중"}</p></div><a href={`/c/${celebrity.slug}`} aria-label={`${celebrity.name} 팬페이지로 이동`}><ArrowRight /></a></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
