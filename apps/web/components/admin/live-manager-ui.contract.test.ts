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
});
