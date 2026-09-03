import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/admin/live-manager.tsx"), "utf8");

describe("ADM-005 Phase 1 reward settings UI contract", () => {
  it("edits only bounded policy inputs through revision-aware commands", () => {
    expect(source).toContain('action:"save_reward_settings"');
    expect(source).toContain('action:"publish_reward_settings"');
    expect(source).toContain("expectedRevision:reward.revision");
    expect(source).toContain('label="Mission Score"');
    expect(source).toContain("min={rewardPolicy.mission.minimumScore} max={rewardPolicy.mission.maximumScore}");
    expect(source).toContain('label="Mission Ticket"');
    expect(source).toContain("min={rewardPolicy.mission.minimumTicket} max={rewardPolicy.mission.maximumTicket}");
    expect(source).toContain('label="Journey Bonus Ticket"');
    expect(source).toContain("min={rewardPolicy.journey.minimumCompletionTicket} max={rewardPolicy.journey.maximumCompletionTicket}");
  });

  it("shows projected totals and preserves Viewer and ended-LIVE read-only behavior", () => {
    expect(source).toContain("reward.configuredLiveScoreMaximum");
    expect(source).toContain("reward.projectedLiveTicketMaximum");
    expect(source).toContain("[reward]");
    expect(source).toContain("!canWrite || pending");
    expect(source).toContain('selected.effectiveStatus === "ended"');
    expect(source).toContain("Mission Ticket 지급은 다음 Phase에서 연결됩니다.");
  });

  it("uses explicit KST conversions and labels for every datetime-local control", () => {
    expect(source).toContain("toKstDateTimeLocal");
    expect(source).toContain("kstDateTimeLocalToInstant");
    for (const field of [
      "reservationOpensAt", "reservationClosesAt", "startsAt", "endsAt",
      "attendanceValidFrom", "attendanceValidUntil", "effectiveFrom", "effectiveUntil",
    ]) expect(source).toContain(field);
    expect(source).not.toContain("(UTC)");
    expect(source).not.toContain("UTC 기준 ISO 시각");
    expect(source).toContain("KST");
  });

  it("uses audited optimistic rescheduling for published LIVE while retaining draft-only save", () => {
    expect(source).toContain('action: "reschedule"');
    expect(source).toContain("expectedRevision:selected.scheduleRevision");
    expect(source).toContain("reason:");
    expect(source).toContain('action: "save"');
    expect(source).toContain('selected.publicationStatus === "draft"');
    expect(source).toContain("selected.everPublishedAt");
    expect(source).toContain("validFrom: selected.attendanceValidFrom");
    expect(source).toContain("disabled={Boolean(selected.everPublishedAt)}");
  });

  it("edits and publishes non-empty revision-aware Journey requirements", () => {
    expect(source).toContain('action:"save_journey_requirements"');
    expect(source).toContain('action:"publish_journey_requirements"');
    expect(source).toContain("expectedRevision:journey.latest.revision");
    expect(source).toContain("requirePassport");
    expect(source).toContain("requireReservation");
    expect(source).toContain("requireAttendance");
    expect(source).toContain("journey?.published");
    expect(source).toContain("journey.publishedReward.bonusTicketAmount");
    expect(source).not.toContain("bonusTicketAmount:reward.journeyBonusTicket");
    expect(source).toContain("disabled={!selectable && !checked}");
    expect(source).toContain("mission.lifecycleStatus");
    expect(source).toContain("mission.version");
  });
});
