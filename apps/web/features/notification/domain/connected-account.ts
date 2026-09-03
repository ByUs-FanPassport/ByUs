import { z } from "zod";

export const connectedAccountSchema = z.object({
  provider: z.enum(["google", "kakao"]),
  status: z.enum(["connected", "disconnected"]),
  connectedAt: z.iso.datetime({ offset: true }),
  disconnectedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const notificationChannelSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["email", "kakao"]),
  status: z.enum(["eligible", "disabled", "needs_verification"]),
  consented: z.boolean(),
  destinationLabel: z.string().min(1),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const notificationConnectionsSchema = z.object({
  accounts: z.array(connectedAccountSchema),
  channels: z.array(notificationChannelSchema),
});

export type ConnectedAccount = z.infer<typeof connectedAccountSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationConnections = z.infer<typeof notificationConnectionsSchema>;

export function parseNotificationConnections(value: unknown): NotificationConnections {
  return notificationConnectionsSchema.parse(value);
}
