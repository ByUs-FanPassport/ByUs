import { parseAppLocale } from "@/i18n/locales";
import { CertificationDetailScreen } from "@/features/certification/ui/certification-detail-screen";
import { z } from "zod";

export default async function CertificationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ locale?: string; submission?: string }>;
}) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const selectedSubmissionId = z.uuid().safeParse(query.submission).success
    ? query.submission
    : undefined;
  return (
    <CertificationDetailScreen
      id={id}
      slug={slug}
      locale={parseAppLocale(query.locale)}
      selectedSubmissionId={selectedSubmissionId}
    />
  );
}
