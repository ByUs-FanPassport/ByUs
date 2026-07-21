import { Suspense } from "react";
import { ProfileOnboardingScreen } from "../../../features/profile/ui/profile-onboarding-screen";

export default function ProfileOnboardingRoute() {
  return <Suspense fallback={null}><ProfileOnboardingScreen /></Suspense>;
}
