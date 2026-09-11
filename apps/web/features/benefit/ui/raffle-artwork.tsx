import { Gift } from "lucide-react";
import type { RaffleList } from "../domain/raffle";
import styles from "./creator-raffles-screen.module.css";

export function RaffleArtwork({ raffle, large = false }: { raffle: RaffleList["raffles"][number]; large?: boolean }) {
  const beepio = raffle.benefitId === "81fc87bf-5264-43dd-ba08-95cf2ffc949b";
  const statue = raffle.benefitId === "a2cd7407-282f-42a9-b562-aee70a271de4";
  const src = raffle.imageUrl ?? (beepio ? "/images/raffles/beepio-case-20260911.webp"
    : statue ? "/images/raffles/banksy-statue-20260911.jpg" : null);
  return <div className={`${styles.artwork} ${large ? styles.largeArtwork : ""} ${beepio ? styles.beepioArtwork : ""} ${statue ? styles.statueArtwork : ""}`}>
    {src ? <img src={src} alt={raffle.title} className={styles.prizePhoto} loading={large ? "eager" : "lazy"} /> : <Gift aria-hidden="true" className={styles.fallbackArt} />}
    {beepio ? <img src="/images/raffles/beepio-wordmark.svg" alt="beepio" className={styles.wordmark} /> : null}
  </div>;
}
