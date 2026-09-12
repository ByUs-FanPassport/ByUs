import { createPhoneSmsDependencies } from "@/server/notification/phone-sms-enrollment-dependencies";
import { createPhoneSmsHandler } from "@/server/notification/phone-sms-enrollment-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return createPhoneSmsHandler("cancel", createPhoneSmsDependencies())(request);
}
