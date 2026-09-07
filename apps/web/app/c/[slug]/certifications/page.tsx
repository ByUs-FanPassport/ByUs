import {
  FanAppFrame,
  FanContentContainer,
} from "@/components/fan-shell/fan-app-shell";
import { CertificationPanel } from "@/features/certification/ui/certification-panel";
export default async function CertificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  return (
    <FanAppFrame locale={locale} mainId="certification-list">
      <FanContentContainer as="main" id="certification-list" tabIndex={-1}>
        <CertificationPanel slug={slug} locale={locale} initialTab="history" />
      </FanContentContainer>
    </FanAppFrame>
  );
}
