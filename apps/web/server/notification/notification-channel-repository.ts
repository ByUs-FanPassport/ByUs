import "server-only";
import { notificationChannelSchema, parseNotificationConnections, type NotificationConnections, type NotificationChannel } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";

export interface NotificationChannelRepository {
  listOwned(appUserId: string): Promise<NotificationConnections>;
  setConsent(input: { appUserId: string; channelId: string; consented: boolean; consentVersion: string }): Promise<NotificationChannel>;
}

export class SupabaseNotificationChannelRepository implements NotificationChannelRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}
  async listOwned(appUserId: string) {
    const { data, error } = await this.client.rpc("get_owned_notification_connections", { p_app_user_id: appUserId });
    if (error) throw new Error("Notification channels are unavailable");
    try { return parseNotificationConnections(data); } catch { throw new Error("Notification channel projection is invalid"); }
  }
  async setConsent(input: { appUserId: string; channelId: string; consented: boolean; consentVersion: string }) {
    const { data, error } = await this.client.rpc("set_owned_notification_channel_consent", {
      p_app_user_id: input.appUserId, p_channel_id: input.channelId,
      p_consented: input.consented, p_consent_version: input.consentVersion,
    });
    if (error) throw new Error("Notification consent update failed");
    try { return notificationChannelSchema.parse(data); } catch { throw new Error("Notification consent projection is invalid"); }
  }
}
