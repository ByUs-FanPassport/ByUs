import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeKakaoKoreanMobile, readKakaoEnrollmentProfile, SupabaseKakaoPhoneEnrollmentRepository } from "./kakao-phone-enrollment";

describe("Kakao phone enrollment", () => {
  it.each(["+82 010-1234-5678", "+821012345678", "+82 10-1234-5678"])("normalizes supported number %s", (phone) => expect(normalizeKakaoKoreanMobile(phone)).toBe("01012345678"));
  it.each(["01012345678", "+12025550123", "+82 02-1234-5678", "+82 010-1234-56789", "+82 010abc12345678"])("rejects unsupported number %s", (phone) => expect(() => normalizeKakaoKoreanMobile(phone)).toThrow("KAKAO_PHONE_UNSUPPORTED"));
  it("requires a positive exact Kakao id and granted phone scope", () => {
    expect(readKakaoEnrollmentProfile({ kakaoSubject: "123", phoneNumber: "+82 10-1234-5678", phoneNumberNeedsAgreement: false })).toEqual({ subject: "123", phone: "01012345678" });
    expect(() => readKakaoEnrollmentProfile({ kakaoSubject: "0", phoneNumber: "+82 10-1234-5678", phoneNumberNeedsAgreement: false })).toThrow("KAKAO_PHONE_SUBJECT_INVALID");
    expect(() => readKakaoEnrollmentProfile({ kakaoSubject: "123", phoneNumber: "+82 10-1234-5678", phoneNumberNeedsAgreement: true })).toThrow("KAKAO_PHONE_AGREEMENT_REQUIRED");
  });
  it("confirms with only owner, pending id, and fixed consent version", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "11111111-1111-4111-8111-111111111111", kind: "kakao", status: "eligible", consented: true, destinationLabel: "010-****-5678", verifiedAt: "2026-09-11T00:00:00Z" }, error: null }));
    await new SupabaseKakaoPhoneEnrollmentRepository({ rpc }).confirm({ appUserId: "owner", enrollmentId: "22222222-2222-4222-8222-222222222222", consentVersion: "kakao-alimtalk-v1" });
    expect(rpc).toHaveBeenCalledWith("confirm_owned_kakao_phone_enrollment", { p_app_user_id: "owner", p_enrollment_id: "22222222-2222-4222-8222-222222222222", p_consent_version: "kakao-alimtalk-v1" });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/010\d{8}/);
  });
});
