import {
  createOnboardingRouteDependencies,
  onboardingUnavailableResponse,
} from "../../../../server/onboarding/onboarding-route-dependencies";
import {
  createGetOnboardingHandler,
  createPostOnboardingHandler,
} from "../../../../server/onboarding/onboarding-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetOnboardingHandler(createOnboardingRouteDependencies())(
      request,
    );
  } catch {
    return onboardingUnavailableResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return createPostOnboardingHandler(createOnboardingRouteDependencies())(
      request,
    );
  } catch {
    return onboardingUnavailableResponse();
  }
}
