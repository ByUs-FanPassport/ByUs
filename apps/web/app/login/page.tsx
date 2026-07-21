import { Suspense } from "react";
import { LoginPage } from "../../components/login-page";
import { readPublicPrivyTestAccountPolicy } from "../../components/privy-test-account-policy";

export default function LoginRoute() {
  return (
    <Suspense fallback={null}>
      <LoginPage testAccountLoginEnabled={readPublicPrivyTestAccountPolicy()} />
    </Suspense>
  );
}
