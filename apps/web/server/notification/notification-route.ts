import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import {
  NotificationSubscriptionBusyError,
  type NotificationRepository,
} from "./notification-repository";

export interface NotificationRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: NotificationRepository;
}
const headers = { "cache-control": "no-store", vary: "Authorization" } as const;
const uuid = z.uuid();
const subscription = z
  .object({
    endpoint: z.url().refine((v) => v.startsWith("https://")),
    keys: z.object({
      p256dh: z.string().min(20).max(200),
      auth: z.string().min(8).max(100),
    }),
  })
  .strict();
const endpoint = z
  .object({ endpoint: z.url().refine((v) => v.startsWith("https://")) })
  .strict();
const patch = z
  .object({
    liveReminders: z.boolean().optional(),
    surveyReminders: z.boolean().optional(),
    benefitNotifications: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
async function fan(
  request: Request,
  deps: NotificationRouteDependencies,
): Promise<AuthorizedFan | Response> {
  try {
    return await deps.authorize(request.headers.get("authorization") ?? "");
  } catch (error) {
    if (error instanceof AuthError)
      return json(
        {
          error: {
            code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
          },
        },
        error.status,
      );
    return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
  }
}
async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    if (
      !(request.headers.get("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/json")
    )
      return null;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const createGetNotificationsHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    const locale =
      new URL(request.url).searchParams.get("locale") === "en" ? "en" : "ko";
    try {
      const notifications = await deps.repository.list({
        appUserId: owner.appUserId,
        locale,
      });
      return json({
        notifications,
        unreadCount: notifications.filter((item) => !item.readAt).length,
      });
    } catch {
      return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
    }
  };
export const createReadNotificationHandler =
  (deps: NotificationRouteDependencies) =>
  async (request: Request, id: string) => {
    if (!uuid.safeParse(id).success)
      return json({ error: { code: "NOTIFICATION_NOT_FOUND" } }, 404);
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    try {
      return (await deps.repository.markRead({
        appUserId: owner.appUserId,
        notificationId: id,
      }))
        ? json({ ok: true })
        : json({ error: { code: "NOTIFICATION_NOT_FOUND" } }, 404);
    } catch {
      return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
    }
  };
export const createReadAllNotificationsHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    try {
      await deps.repository.markAllRead(owner.appUserId);
      return json({ ok: true });
    } catch {
      return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
    }
  };
export const createPutSubscriptionHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    const input = await body(request, subscription);
    if (!input) return json({ error: { code: "INVALID_SUBSCRIPTION" } }, 400);
    try {
      await deps.repository.putSubscription({
        appUserId: owner.appUserId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: request.headers.get("user-agent"),
      });
      return json({ ok: true });
    } catch (error) {
      return error instanceof NotificationSubscriptionBusyError
        ? json({ error: { code: "SUBSCRIPTION_TRANSFER_BUSY" } }, 409)
        : json({ error: { code: "SUBSCRIPTION_UNAVAILABLE" } }, 503);
    }
  };
export const createDeleteSubscriptionHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    const input = await body(request, endpoint);
    if (!input) return json({ error: { code: "INVALID_SUBSCRIPTION" } }, 400);
    try {
      await deps.repository.deleteSubscription({
        appUserId: owner.appUserId,
        endpoint: input.endpoint,
      });
      return json({ ok: true });
    } catch {
      return json({ error: { code: "SUBSCRIPTION_UNAVAILABLE" } }, 503);
    }
  };
export const createGetPreferencesHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    try {
      return json({
        preferences: await deps.repository.getPreferences(owner.appUserId),
      });
    } catch {
      return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
    }
  };
export const createPatchPreferencesHandler =
  (deps: NotificationRouteDependencies) => async (request: Request) => {
    const owner = await fan(request, deps);
    if (owner instanceof Response) return owner;
    const input = await body(request, patch);
    if (!input) return json({ error: { code: "INVALID_PREFERENCES" } }, 400);
    try {
      return json({
        preferences: await deps.repository.patchPreferences({
          appUserId: owner.appUserId,
          ...input,
        }),
      });
    } catch {
      return json({ error: { code: "NOTIFICATIONS_UNAVAILABLE" } }, 503);
    }
  };
