import { describe, expect, it, vi } from "vitest";
import {
  BenefitMaintenance,
  normalizeMaintenanceError,
} from "../src/benefit-maintenance.js";

describe("BenefitMaintenance", () => {
  it("runs one bounded purge and records success without recipient payload", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const clock = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-09-04T00:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-04T00:00:00.125Z"));

    await expect(new BenefitMaintenance({ rpc }, clock).runOnce()).resolves.toEqual({
      success: true,
      deletedCount: 2,
      durationMs: 125,
      lastSuccessAt: "2026-09-04T00:00:00.125Z",
      lastError: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "purge_due_benefit_recipient_private", {
      p_now: "2026-09-04T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_benefit_recipient_purge_run", {
      p_started_at: "2026-09-04T00:00:00.000Z",
      p_finished_at: "2026-09-04T00:00:00.125Z",
      p_deleted_count: 2,
      p_error_code: null,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/name|phone|address/i);
  });

  it("records a normalized failure and never runs notification work", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "secret row data" } })
      .mockResolvedValueOnce({ data: true, error: null });
    const clock = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-09-04T00:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-04T00:00:00.010Z"));

    await expect(new BenefitMaintenance({ rpc }, clock).runOnce()).resolves.toEqual({
      success: false,
      deletedCount: 0,
      durationMs: 10,
      lastSuccessAt: null,
      lastError: "PURGE_RPC_FAILED",
    });
    expect(rpc).toHaveBeenLastCalledWith("record_benefit_recipient_purge_run", {
      p_started_at: "2026-09-04T00:00:00.000Z",
      p_finished_at: "2026-09-04T00:00:00.010Z",
      p_deleted_count: 0,
      p_error_code: "PURGE_RPC_FAILED",
    });
  });

  it("normalizes unknown errors to a stable allowlist", () => {
    expect(normalizeMaintenanceError(new Error("contains PII"))).toBe(
      "PURGE_RPC_FAILED",
    );
  });
});
