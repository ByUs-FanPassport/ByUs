import "server-only";

import { z } from "zod";
import { AppleLifecycleRepository, providerSubjectHash, sha256 } from "./apple-lifecycle";
import { boundedText } from "./reauthentication-provider";
import {
  APPLE_NOTIFICATION_AUDIENCES, InvalidAppleNotificationError,
  verifyAppleNotification, type VerifiedAppleNotification,
} from "./verify-apple-notification";

export interface AppleNotificationRouteDependencies {
  repository: AppleLifecycleRepository;
  verify?: (token: string) => Promise<VerifiedAppleNotification>;
}

const payloadSchema = z.object({ payload: z.string().min(1).max(16_384) }).strict();
const responseHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export async function receiveAppleNotification(request: Request, dependencies: AppleNotificationRouteDependencies): Promise<Response> {
  let token: string;
  try {
    if (request.method !== "POST" || request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new Error("Invalid notification request");
    }
    token = payloadSchema.parse(JSON.parse(await boundedText(request, 20_480))).payload;
  } catch {
    return Response.json({ error: { code: "INVALID_APPLE_NOTIFICATION" } }, { status: 400, headers: responseHeaders });
  }
  let event: VerifiedAppleNotification;
  try {
    event = await (dependencies.verify ?? ((value) => verifyAppleNotification(value, {
      trustedAudiences: APPLE_NOTIFICATION_AUDIENCES,
    })))(token);
  } catch (error) {
    const invalid = error instanceof InvalidAppleNotificationError;
    return Response.json({ error: { code: invalid ? "INVALID_APPLE_NOTIFICATION" : "APPLE_NOTIFICATION_UNAVAILABLE" } }, {
      status: invalid ? 400 : 503, headers: responseHeaders,
    });
  }
  try {
    await dependencies.repository.call("apply_apple_account_notification", {
      p_event: {
        eventId: event.eventId, payloadHash: event.payloadHash,
        audience: event.audience, type: event.type,
        subjectHash: providerSubjectHash("apple", event.subject),
        eventTime: event.eventTime, issuedAt: event.issuedAt,
        emailFingerprint: event.email ? sha256(event.email) : null,
      },
    });
    return Response.json({ received: true }, { status: 200, headers: responseHeaders });
  } catch {
    return Response.json({ error: { code: "APPLE_NOTIFICATION_UNAVAILABLE" } }, { status: 503, headers: responseHeaders });
  }
}
