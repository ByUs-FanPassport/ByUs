import { describe, expect, it, vi } from "vitest";
import { createNotificationLambdaHandler } from "../src/notification-lambda.js";
const secret = JSON.stringify({
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_WORKER_ID: "notify-prod-1",
  NOTIFICATION_WORKER_BATCH_SIZE: "25",
  NOTIFICATION_WORKER_LEASE_SECONDS: "120",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
  WEB_PUSH_VAPID_SUBJECT: "mailto:ops@byus.example",
  WEB_PUSH_VAPID_PUBLIC_KEY: "A".repeat(88),
  WEB_PUSH_VAPID_PRIVATE_KEY: "B".repeat(43),
});
describe("notification Lambda", () => {
  it("loads validated Secrets Manager config and runs once", async () => {
    const runWorker = vi.fn(async () => 3);
    const handler = createNotificationLambdaHandler(
      { loadSecret: vi.fn(async () => secret), runWorker },
      {
        NOTIFICATION_WORKER_ENABLED: "true",
        NOTIFICATION_WORKER_ENVIRONMENT: "prod",
        NOTIFICATION_WORKER_SECRET_ID: "byus/notification/prod",
      },
    );
    await expect(
      handler({ source: "byus.notification-cron", environment: "prod" }),
    ).resolves.toEqual({ enabled: true, claimed: 3 });
    expect(runWorker).toHaveBeenCalledOnce();
  });
  it("rejects cross-environment invocation before reading secrets", async () => {
    const loadSecret = vi.fn(async () => secret);
    const handler = createNotificationLambdaHandler(
      { loadSecret, runWorker: vi.fn(async () => 0) },
      {
        NOTIFICATION_WORKER_ENABLED: "true",
        NOTIFICATION_WORKER_ENVIRONMENT: "prod",
        NOTIFICATION_WORKER_SECRET_ID: "byus/notification/prod",
      },
    );
    await expect(
      handler({ source: "byus.notification-cron", environment: "dev" }),
    ).rejects.toThrow("mismatch");
    expect(loadSecret).not.toHaveBeenCalled();
  });

  it("runs maintenance independently without entering notification processing", async () => {
    const runWorker = vi.fn(async () => 99);
    const runMaintenance = vi.fn(async () => ({
      success: true,
      deletedCount: 2,
      notificationJobsProcessed: 0,
      durationMs: 12,
      lastSuccessAt: "2026-09-04T00:00:00.000Z",
      lastError: null,
    }));
    const emitMaintenanceMetric = vi.fn();
    const handler = createNotificationLambdaHandler(
      { loadSecret: vi.fn(async () => secret), runWorker, runMaintenance, emitMaintenanceMetric },
      {
        NOTIFICATION_WORKER_ENABLED: "false",
        NOTIFICATION_WORKER_ENVIRONMENT: "dev",
        NOTIFICATION_WORKER_SECRET_ID: "byus/notification/dev",
        BENEFIT_MAINTENANCE_ENABLED: "true",
      },
    );
    await expect(handler({
      source: "byus.maintenance-cron",
      environment: "dev",
      mode: "maintenance",
    })).resolves.toMatchObject({
      enabled: true,
      mode: "maintenance",
      success: true,
      deletedCount: 2,
      lastError: null,
    });
    expect(runMaintenance).toHaveBeenCalledOnce();
    expect(runWorker).not.toHaveBeenCalled();
    expect(emitMaintenanceMetric).toHaveBeenCalledOnce();
  });
});
