import { BenefitRecipientScreen } from "@/features/benefit/ui/benefit-recipient-screen";

export default async function BenefitRecipientPage({
  params,
  searchParams,
}: {
  params: Promise<{ winnerId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ winnerId }, query] = await Promise.all([params, searchParams]);
  return <BenefitRecipientScreen winnerId={winnerId} locale={query.locale === "en" ? "en" : "ko"} />;
}
