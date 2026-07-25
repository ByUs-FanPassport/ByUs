import { FanState } from "./fan-state";
import styles from "./fan-route-loading.module.css";

type FanRouteLoadingProps = Readonly<{
  locale?: "ko" | "en";
  presentation?: "page" | "overlay";
}>;

export function FanRouteLoading({
  locale = "ko",
  presentation = "page",
}: FanRouteLoadingProps) {
  return (
    <div className={styles[presentation]}>
      <FanState
        kind="loading"
        title={locale === "en" ? "Loading this page." : "페이지를 불러오는 중이에요."}
      />
    </div>
  );
}

