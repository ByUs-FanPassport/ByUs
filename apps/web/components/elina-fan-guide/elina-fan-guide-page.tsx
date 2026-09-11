import type { GuideImages } from "@/server/media/guide-images";
import type { FanLocale } from "../fan-shell/fan-app-shell";
import { FanParticipationGuide } from "../fan-participation-guide/fan-participation-guide";

export function ElinaFanGuidePage({ locale, images }: { locale: FanLocale; images: GuideImages }) {
  return <FanParticipationGuide locale={locale} creator="elina" images={images} />;
}
