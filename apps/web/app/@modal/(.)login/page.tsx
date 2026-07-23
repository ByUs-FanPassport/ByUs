import { Suspense } from "react";
import { LoginPage } from "../../../components/login-page";
import { readPublicPrivyTestAccountPolicy } from "../../../components/privy-test-account-policy";

export default function LoginModalRoute() {
  return (
    <Suspense fallback={null}>
      <LoginPage
        presentation="overlay"
        testAccountLoginEnabled={readPublicPrivyTestAccountPolicy()}
      />
    </Suspense>
  );
}
