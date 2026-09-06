import { Suspense } from "react";
import { LoginPage } from "../../../components/login-page";
import { readPublicPrivyTestAccountPolicy } from "../../../components/privy-test-account-policy";
import { readPublicPrivyAppleLoginPolicy } from "../../../components/privy-apple-login-policy";
import { FanRouteLoading } from "../../../components/fan-ui/fan-route-loading";

export default async function LoginModalRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const locale = query.locale === "en" ? "en" : "ko";
  return (
    <Suspense
      fallback={<FanRouteLoading locale={locale} presentation="overlay" />}
    >
      <LoginPage
        presentation="overlay"
        appleLoginEnabled={readPublicPrivyAppleLoginPolicy()}
        testAccountLoginEnabled={readPublicPrivyTestAccountPolicy()}
      />
    </Suspense>
  );
}
