import { createKakaoEnrollmentDependencies } from "@/server/notification/kakao-enrollment-dependencies";
import { createCancelKakaoEnrollmentHandler } from "@/server/notification/kakao-enrollment-route";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return createCancelKakaoEnrollmentHandler(createKakaoEnrollmentDependencies())(request); }
