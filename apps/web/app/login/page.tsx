import { Suspense } from "react";
import { LoginPage } from "../../components/login-page";
import { readPublicPrivyTestAccountPolicy } from "../../components/privy-test-account-policy";
import { FanRouteLoading } from "../../components/fan-ui/fan-route-loading";

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const locale = query.locale === "en" ? "en" : "ko";
  return (
    <Suspense fallback={<FanRouteLoading locale={locale} />}>
      <LoginPage testAccountLoginEnabled={readPublicPrivyTestAccountPolicy()} />
    </Suspense>
  );
}
