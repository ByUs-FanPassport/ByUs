import Image from "next/image";
import Link from "next/link";

import styles from "./focus-flow-brand.module.css";

export function FocusFlowBrand() {
  return (
    <Link className={styles.brand} href="/" aria-label="kyaa 홈">
      <Image
        src="/images/guest-home/kyaa-wordmark.svg"
        alt="kyaa"
        width={80}
        height={39}
        priority
      />
    </Link>
  );
}
