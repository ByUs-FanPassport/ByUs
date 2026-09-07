import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260908040000_fan_raffle_lifecycle.sql",
  ),
  "utf8",
);

describe("raffle lifecycle migration contract", () => {
  it("serializes entry, cancellation, and draw on the campaign row", () => {
    expect(
      sql.match(/live_benefit_campaigns[\s\S]{0,180}for update/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("PHASE4_BENEFIT_DRAW_CANCELLED");
    expect(sql).toContain("PHASE4_BENEFIT_CAMPAIGN_CANNOT_CANCEL");
  });

  it("keeps refunds and publication append-only and unique", () => {
    expect(sql).toMatch(/entry_id uuid not null unique/);
    expect(sql).toMatch(/draw_id uuid primary key/);
    expect(sql).toContain(
      "array['benefit_entry_refunds','benefit_draw_publications']",
    );
    expect(sql).toContain("t||'_reject_update_delete'");
  });

  it("gates owner and fulfillment paths on draw publication", () => {
    expect(sql).toMatch(
      /get_owned_benefit_rewards[\s\S]*benefit_draw_publications/,
    );
    expect(sql).toMatch(
      /save_owned_benefit_recipient[\s\S]*PHASE4_REWARD_NOT_PUBLISHED/,
    );
    expect(sql).toMatch(
      /transition_admin_benefit_fulfillment[\s\S]*PHASE4_REWARD_NOT_PUBLISHED/,
    );
    expect(sql).toContain("suppress_unpublished_benefit_draw_notification");
    expect(sql).toMatch(
      /phase5_notify_benefit_winner[\s\S]*benefit_draw_publications/,
    );
    expect(sql).toMatch(/publish_admin_benefit_draw[\s\S]*'benefit_won'/);
    expect(sql).toMatch(
      /email_notification_delivery_is_eligible[\s\S]*benefit_draw_publications/,
    );
    expect(sql).toMatch(
      /phase5_notify_fulfillment_update[\s\S]*benefit_draw_publications/,
    );
  });

  it("keeps hidden parents private and binds publication to the campaign path", () => {
    expect(sql).toContain(
      "celebrity.status='published' and celebrity.archived_at is null",
    );
    expect(sql).toContain(
      "e.publication_status='published' and e.archived_at is null",
    );
    expect(sql).toContain("and b.archived_at is null");
    expect(sql).toContain("c.status='published' and b.publication_status='published'");
    expect(sql).toContain("PHASE4_BENEFIT_DRAW_CAMPAIGN_MISMATCH");
  });

  it("exposes only explicit undated draft teasers with stable item ids and curated images", () => {
    expect(sql).toContain("benefits_claim_lifecycle_shape");
    expect(sql).toContain("c.status='draft' and c.public_teaser and b.publication_status='draft'");
    expect(sql).toContain("'id',i.id");
    expect(sql).toContain("'imageUrl',i.teaser_image_url");
    expect(sql).toContain("'teaserImageUrl',campaign_item.teaser_image_url");
    expect(sql).toContain('set teaser_image_url=input."teaserImageUrl"');
  });

  it("refunds from the immutable debit snapshot even after owner or celebrity deactivation", () => {
    expect(sql).toMatch(
      /post_benefit_entry_refund[\s\S]*original\.entry_kind<>'debit'/,
    );
    expect(sql).toMatch(
      /post_benefit_entry_refund[\s\S]*insert into public\.fan_ticket_ledger/,
    );
    expect(sql).not.toMatch(
      /post_benefit_entry_refund[\s\S]{0,2500}status='active'/,
    );
  });
});
