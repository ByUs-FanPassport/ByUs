import { createKakaoEnrollmentDependencies } from "@/server/notification/kakao-enrollment-dependencies";
import { createConfirmKakaoEnrollmentHandler } from "@/server/notification/kakao-enrollment-route";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return createConfirmKakaoEnrollmentHandler(createKakaoEnrollmentDependencies())(request); }
