import{readFileSync}from"node:fs";import{resolve}from"node:path";import{describe,expect,it}from"vitest";const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260903041000_phase6_live_analytics.sql"),"utf8");describe("LIVE analytics SQL contract",()=>{it("keeps events measurement-only and Mission outside the funnel",()=>{expect(sql).toContain("event_name='live_page_view'");expect(sql).toContain("live_reservations");expect(sql).toContain("live_attendances");expect(sql).toContain("live_survey_responses");expect(sql).toContain("live_journey_participations");expect(sql).toContain("benefit_ticket_entries");expect(sql).toContain("live_collectible_claims");expect(sql).toContain("SMALL_COHORT_LT_5");expect(sql).not.toContain("event_name='reservation_completed'");});});


describe("per-LIVE attribution correction", () => {
  it("requires LIVE-bound operational evidence for Passport and Reaction chain facts", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "../../supabase/migrations/20260903041100_phase6_live_attribution_fix.sql"),
      "utf8",
    );
    expect(sql).toContain("quiz_pass_attributions qa");
    expect(sql).toContain("qa.source_type='live'");
    expect(sql).toContain("pe.event_name='reaction_completed'");
    expect(sql).toContain("pe.properties->>'reactionId'=r.id::text");
    expect(sql).not.toContain("where p.celebrity_id=e.celebrity_id");
  });
});
