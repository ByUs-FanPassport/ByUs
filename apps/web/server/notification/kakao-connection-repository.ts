import "server-only";
import { connectedAccountSchema, type ConnectedAccount } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";

export class SupabaseKakaoConnectionRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}
  async createState(input: { appUserId: string; stateHash: string; codeVerifier: string; returnPath: string }): Promise<void> {
    const { error } = await this.client.rpc("create_owned_kakao_connection_state", { p_app_user_id: input.appUserId, p_state_hash: input.stateHash, p_code_verifier: input.codeVerifier, p_return_path: input.returnPath });
    if (error) throw new Error("Kakao connection state creation failed");
  }
  async consumeState(input: { appUserId: string; stateHash: string }): Promise<{ codeVerifier: string; returnPath: string }> {
    const { data, error } = await this.client.rpc("consume_owned_kakao_connection_state", { p_app_user_id: input.appUserId, p_state_hash: input.stateHash });
    if (error || !data || typeof data !== "object") throw new Error("Kakao connection state is invalid");
    const row = data as Record<string, unknown>;
    if (typeof row.codeVerifier !== "string" || typeof row.returnPath !== "string") throw new Error("Kakao connection state is invalid");
    return { codeVerifier: row.codeVerifier, returnPath: row.returnPath };
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
}
