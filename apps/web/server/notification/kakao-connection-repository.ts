import "server-only";
import { z } from "zod";
import { connectedAccountSchema, type ConnectedAccount } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";

export class SupabaseKakaoConnectionRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}
  async createState(input: { appUserId: string; stateHash: string; codeVerifier: string; returnPath: string; purpose?: "connection" | "alimtalk" }): Promise<void> {
    const rpc = input.purpose === "alimtalk" ? "create_owned_kakao_alimtalk_state" : "create_owned_kakao_connection_state";
    const { error } = await this.client.rpc(rpc, { p_app_user_id: input.appUserId, p_state_hash: input.stateHash, p_code_verifier: input.codeVerifier, p_return_path: input.returnPath });
    if (error) throw new Error("Kakao connection state creation failed");
  }
  async consumeState(input: { appUserId: string; stateHash: string }): Promise<{ codeVerifier: string; returnPath: string; purpose: "connection" | "alimtalk"; consentVersion: string | null }> {
    const { data, error } = await this.client.rpc("consume_owned_kakao_connection_state", { p_app_user_id: input.appUserId, p_state_hash: input.stateHash });
    if (error || !data || typeof data !== "object") throw new Error("Kakao connection state is invalid");
    const row = data as Record<string, unknown>;
    const legacyShape = row.purpose === undefined && row.consentVersion === undefined;
    const purpose = legacyShape ? "connection" : row.purpose;
    const consentVersion = legacyShape ? null : row.consentVersion;
    if (typeof row.codeVerifier !== "string" || typeof row.returnPath !== "string" ||
      (purpose !== "connection" && purpose !== "alimtalk") ||
      (consentVersion !== null && typeof consentVersion !== "string")) throw new Error("Kakao connection state is invalid");
    return { codeVerifier: row.codeVerifier, returnPath: row.returnPath, purpose, consentVersion };
  }
  async complete(input: { appUserId: string; subjectHash: string }): Promise<ConnectedAccount> {
    const { data, error } = await this.client.rpc("complete_owned_kakao_connection", { p_app_user_id: input.appUserId, p_subject_hash: input.subjectHash });
    if (error) throw new Error("Kakao connection completion failed");
    return connectedAccountSchema.parse(data);
  }
  async disconnect(appUserId: string): Promise<ConnectedAccount> {
    const { data, error } = await this.client.rpc("disconnect_owned_kakao_connection", { p_app_user_id: appUserId });
    if (error) throw new Error("Kakao disconnect failed");
    return connectedAccountSchema.parse(data);
  }
  async stageEnrollment(input: { appUserId: string; stateHash: string; subjectHash: string; phone: string }) {
    const { data, error } = await this.client.rpc("stage_owned_kakao_phone_enrollment", {
      p_app_user_id: input.appUserId, p_state_hash: input.stateHash,
      p_subject_hash: input.subjectHash, p_phone: input.phone,
    });
    if (error) throw new Error("Kakao phone enrollment staging failed");
    return kakaoEnrollmentSchema.parse(data);
  }
}

export const kakaoEnrollmentSchema = z.object({
  id: z.string().uuid(), destinationLabel: z.string().min(1).max(64),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type KakaoEnrollment = z.infer<typeof kakaoEnrollmentSchema>;
