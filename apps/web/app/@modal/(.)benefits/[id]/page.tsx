import {
  BenefitDetailOverlay,
  type BenefitLocale,
} from "@/features/benefit/ui/benefit-screen";

function locale(value: string | string[] | undefined): BenefitLocale {
  return value === "en" ? "en" : "ko";
}

function slug(value: string | string[] | undefined) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : undefined;
}

export default async function BenefitModalRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return (
    <BenefitDetailOverlay
      benefitId={id}
      locale={locale(query.locale)}
      celebrity={slug(query.celebrity)}
    />
  );
}
