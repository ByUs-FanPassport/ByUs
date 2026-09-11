import { Gift } from "lucide-react";

import type { BenefitCatalogItem } from "../domain/benefit";
import styles from "./benefit-artwork.module.css";

const fallbackArtworkByBenefitId: Readonly<Record<string, string>> = {
  "81fc87bf-5264-43dd-ba08-95cf2ffc949b":
    "/images/raffles/beepio-case-20260911.webp",
  "a2cd7407-282f-42a9-b562-aee70a271de4":
    "/images/raffles/banksy-statue-20260911.jpg",
};

export function benefitArtworkSource(
  benefit: Pick<BenefitCatalogItem, "id" | "imageUrl">,
): string | null {
  return benefit.imageUrl ?? fallbackArtworkByBenefitId[benefit.id] ?? null;
}

export function BenefitArtwork({
  benefit,
  large = false,
  className,
}: {
  benefit: Pick<BenefitCatalogItem, "id" | "imageUrl" | "title">;
  large?: boolean;
  className?: string;
}) {
  const source = benefitArtworkSource(benefit);
  const beepio = benefit.id === "81fc87bf-5264-43dd-ba08-95cf2ffc949b";
  const statue = benefit.id === "a2cd7407-282f-42a9-b562-aee70a271de4";

  return (
    <div
      className={`${styles.artwork} ${large ? styles.large : ""} ${
        beepio ? styles.beepio : ""
      } ${statue ? styles.statue : ""} ${className ?? ""}`}
    >
      {source ? (
        <img
          src={source}
          alt={benefit.title}
          className={styles.image}
          loading={large ? "eager" : "lazy"}
        />
      ) : (
        <Gift aria-hidden="true" className={styles.fallback} />
      )}
      {beepio && source ? (
        <img
          src="/images/raffles/beepio-wordmark.svg"
          alt="beepio"
          className={styles.wordmark}
        />
      ) : null}
    </div>
  );
}
