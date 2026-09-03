import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseNotificationChannelRepository } from "./notification-channel-repository";

it("changes channel consent without changing connection state", async () => {
  const channel = { id: "40000000-0000-4000-8000-000000000001", kind: "email", status: "disabled", consented: false, destinationLabel: "f***@example.com", verifiedAt: "2026-09-04T00:00:00.000Z" };
  const rpc = vi.fn().mockResolvedValue({ data: channel, error: null });
  const repository = new SupabaseNotificationChannelRepository({ rpc });
  await expect(repository.setConsent({ appUserId: "owner", channelId: channel.id, consented: false, consentVersion: "2026-09-v1" })).resolves.toEqual(channel);
  expect(rpc).toHaveBeenCalledWith("set_owned_notification_channel_consent", expect.objectContaining({ p_app_user_id: "owner", p_consented: false }));
});
