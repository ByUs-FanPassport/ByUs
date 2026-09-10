import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FanParticipationGuide } from "../fan-participation-guide/fan-participation-guide";

export function ElinaFanGuidePage({ locale }: { locale: FanLocale }) {
  return <FanParticipationGuide locale={locale} creator="elina" />;
}
