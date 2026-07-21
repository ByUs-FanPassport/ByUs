import { Suspense } from "react";
import { LoginPage } from "../../components/login-page";

export default function LoginRoute() {
  return <Suspense fallback={null}><LoginPage /></Suspense>;
}
