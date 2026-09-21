import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("mobile platform contracts", () => {
  it("keeps iOS viewport, height, input zoom, and raffle-tab fixes in place", () => {
    expect(read("app/layout.tsx")).toContain('viewportFit: "cover"');
    expect(read("features/fanpage/ui/fanpage.module.css").match(/\.availableRaffleTab\{([^}]*)\}/)?.[1]).toContain("white-space:nowrap");

    for (const file of [
      "components/celebrity-fan-page.module.css",
      "components/guest-home.module.css",
      "features/benefit/ui/benefit-screen.module.css",
      "features/passport/ui/passport-screens.module.css",
      "features/notification/ui/kakao-callback-screen.module.css",
      "features/notification/ui/notification-center.module.css",
      "features/live/ui/live-event-screen.module.css",
      "features/live/ui/live-survey-screen.module.css",
      "features/bias/ui/promotion-page.module.css",
      "features/profile/ui/settings-screen.module.css",
    ]) expect(read(file), file).not.toMatch(/(?:min-)?height:\s*(?:calc\()?100vh/);

    expect(read("features/lounge/ui/lounge.module.css")).toMatch(/\.composer textarea\{[^}]*font-size:16px/);
    expect(read("features/my/ui/my-benefit-progress.module.css")).toMatch(/\.selector select\s*\{[^}]*font-size:16px/);
    expect(read("features/bias/ui/promotion-page.module.css")).toMatch(/\.searchInput input\s*\{[^}]*font-size:\s*16px/);
    expect(read("components/fan-shell/fan-language-switch.module.css")).toMatch(/\.language\s*\{[^}]*font-size:\s*16px/);
  });
});
