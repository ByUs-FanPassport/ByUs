import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ProfileOnboardingScreen } from "../../../features/profile/ui/profile-onboarding-screen";
import { sanitizeEntity, sanitizeLocale } from "../../../components/login-intent";
import { createPublishedContentRepositoryFromEnvironment } from "../../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export default async function ProfileOnboardingRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : null);
  const entity = sanitizeEntity(typeof query.entity === "string" ? query.entity : null);
  if (!entity) redirect(`/?locale=${locale}`);

  let celebrity = null;
  try {
    celebrity = await createPublishedContentRepositoryFromEnvironment().findBySlug(locale, entity);
  } catch {
    redirect(`/?locale=${locale}`);
  }
  if (!celebrity) redirect(`/?locale=${locale}`);

  return (
    <Suspense fallback={null}>
      <ProfileOnboardingScreen celebrity={celebrity} />
    </Suspense>
  );
}
