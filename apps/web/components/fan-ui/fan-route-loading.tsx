import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__fan-ui__fan-route-loading";
import { translate } from "@/i18n/messages";
import { FanState } from "./fan-state";
import styles from "./fan-route-loading.module.css";

type FanRouteLoadingProps = Readonly<{
  locale?: AppLocale;
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
        title={locale === "ko" ? "페이지를 불러오는 중이에요." : translate(locale, localizedMessages.m115ef1f104f6, "Loading this page.")}
      />
    </div>
  );
}

