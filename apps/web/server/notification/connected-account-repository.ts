import "server-only";
import type { ConnectedAccount } from "../../features/notification/domain/connected-account";
import { parseNotificationConnections } from "../../features/notification/domain/connected-account";

export interface NotificationConnectionRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export class SupabaseConnectedAccountRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}

  async listOwned(appUserId: string): Promise<ConnectedAccount[]> {
    const { data, error } = await this.client.rpc("get_owned_notification_connections", { p_app_user_id: appUserId });
    if (error) throw new Error("Connected accounts are unavailable");
    try { return parseNotificationConnections(data).accounts; }
    catch { throw new Error("Connected account projection is invalid"); }
  }
}
