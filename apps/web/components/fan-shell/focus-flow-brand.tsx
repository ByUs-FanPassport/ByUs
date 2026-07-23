import Image from "next/image";
import Link from "next/link";

import styles from "./focus-flow-brand.module.css";

export function FocusFlowBrand() {
  return (
    <Link className={styles.brand} href="/" aria-label="ByUs 홈">
      <Image
        src="/images/guest-home/byus-wordmark.svg"
        alt="ByUs"
        width={80}
        height={30}
        priority
      />
    </Link>
  );
}
