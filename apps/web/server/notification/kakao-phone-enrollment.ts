import "server-only";

import { notificationChannelSchema, type NotificationChannel } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";
import { kakaoEnrollmentSchema, type KakaoEnrollment } from "./kakao-connection-repository";

export const KAKAO_ALIMTALK_CONSENT_VERSION = "kakao-alimtalk-v1";

export class KakaoPhoneEnrollmentError extends Error {
  constructor(readonly code: string) { super(code); this.name = "KakaoPhoneEnrollmentError"; }
}

function fail(code: string): never { throw new KakaoPhoneEnrollmentError(code); }

export function normalizeKakaoKoreanMobile(value: unknown): string {
  if (typeof value !== "string" || value.length > 32 || !/^\+82[ 0-9-]+$/.test(value)) fail("KAKAO_PHONE_UNSUPPORTED");
  const national = value.slice(3).replace(/[ -]/g, "");
  const domestic = national.startsWith("0") ? national : `0${national}`;
  if (!/^010\d{8}$/.test(domestic)) fail("KAKAO_PHONE_UNSUPPORTED");
  return domestic;
}

export function readKakaoEnrollmentProfile(value: {
  kakaoSubject: string;
  phoneNumber?: unknown;
  phoneNumberNeedsAgreement?: unknown;
}): { subject: string; phone: string } {
  if (!/^[1-9]\d{0,19}$/.test(value.kakaoSubject)) fail("KAKAO_PHONE_SUBJECT_INVALID");
  if (value.phoneNumberNeedsAgreement !== false) fail("KAKAO_PHONE_AGREEMENT_REQUIRED");
  return { subject: value.kakaoSubject, phone: normalizeKakaoKoreanMobile(value.phoneNumber) };
}

export class SupabaseKakaoPhoneEnrollmentRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}
  async getPending(appUserId: string): Promise<KakaoEnrollment | null> {
    const { data, error } = await this.client.rpc("get_owned_kakao_phone_enrollment", { p_app_user_id: appUserId });
    if (error) throw new Error("Kakao enrollment is unavailable");
    return data === null ? null : kakaoEnrollmentSchema.parse(data);
  }
  async confirm(input: { appUserId: string; enrollmentId: string; consentVersion: string }): Promise<NotificationChannel> {
    const { data, error } = await this.client.rpc("confirm_owned_kakao_phone_enrollment", {
      p_app_user_id: input.appUserId, p_enrollment_id: input.enrollmentId,
      p_consent_version: input.consentVersion,
    });
    if (error) throw new Error("Kakao enrollment confirmation failed");
    return notificationChannelSchema.parse(data);
  }
  async cancel(appUserId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("cancel_owned_kakao_phone_enrollment", { p_app_user_id: appUserId });
    if (error || typeof data !== "boolean") throw new Error("Kakao enrollment cancellation failed");
    return data;
  }
}
