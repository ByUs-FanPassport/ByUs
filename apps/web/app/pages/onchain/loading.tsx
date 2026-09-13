import { FanContentContainer } from "@/components/fan-shell/fan-content-container";
import styles from "@/components/onchain/onchain-public-page.module.css";

export default function Loading() {
  return (
    <main className={styles.page} aria-busy="true">
      <section className={styles.hero} aria-live="polite">
        <FanContentContainer>
          <p className={styles.eyebrow}>PUBLIC ONCHAIN RECORDS</p>
          <h1>ByUs onchain records</h1>
          <p className={styles.intro} role="status">GIWA Sepolia의 최신 확정 스냅샷을 불러오는 중입니다. / Loading the latest finalized GIWA Sepolia snapshot…</p>
        </FanContentContainer>
      </section>
    </main>
  );
}
