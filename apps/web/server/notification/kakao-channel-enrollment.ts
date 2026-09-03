import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { notificationChannelSchema, type NotificationChannel } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";

export interface KakaoNotificationEnrollmentPort {
  verifyDestination(input: { appUserId: string; connectedSubject: string; verificationProof: string }): Promise<{ canonicalRecipientKey: string; label: string; verifiedAt: string }>;
}
type Fixture={appUserId:string;connectedSubject:string;recipientKey:string;label:string;nonce:string};
export class TestSinkKakaoEnrollmentPort implements KakaoNotificationEnrollmentPort {
  constructor(private readonly secret:string) { if(secret.length<16) throw new Error("Kakao test-sink secret is required"); }
  async verifyDestination(input:{appUserId:string;connectedSubject:string;verificationProof:string}){
    const [payload,signature]=input.verificationProof.split("."); if(!payload||!signature) throw new Error("Invalid Kakao enrollment proof");
    const expected=createHmac("sha256",this.secret).update(payload).digest("base64url");
    const a=Buffer.from(signature); const b=Buffer.from(expected); if(a.length!==b.length||!timingSafeEqual(a,b)) throw new Error("Invalid Kakao enrollment proof");
    const fixture=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as Fixture;
    if(fixture.appUserId!==input.appUserId||fixture.connectedSubject!==input.connectedSubject||!fixture.nonce) throw new Error("Kakao enrollment owner mismatch");
    return {canonicalRecipientKey:fixture.recipientKey,label:fixture.label,verifiedAt:new Date().toISOString()};
  }
}
export function signTestSinkKakaoEnrollment(secret:string,fixture:Fixture):string { const payload=Buffer.from(JSON.stringify(fixture)).toString("base64url"); return `${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`; }

export class SupabaseKakaoChannelEnrollmentRepository {
  constructor(private readonly client:NotificationConnectionRpcClient){}
  async enroll(input:{appUserId:string;proof:string;recipientKey:string;label:string;consentVersion:string}):Promise<NotificationChannel>{
    const {data,error}=await this.client.rpc("enroll_owned_kakao_notification_channel",{p_app_user_id:input.appUserId,p_proof_hash:createHash("sha256").update(input.proof).digest("hex"),p_recipient_key:input.recipientKey,p_destination_label:input.label,p_consent_version:input.consentVersion});
    if(error) throw new Error("Kakao notification enrollment failed"); return notificationChannelSchema.parse(data);
  }
}
