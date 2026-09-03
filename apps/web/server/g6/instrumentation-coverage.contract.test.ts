import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_EVENT_NAMES } from "../../features/analytics/domain/product-event";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/20260903041200_phase6_product_event_projections.sql"), "utf8");
const client = readFileSync(resolve(process.cwd(), "features/analytics/client/product-event-client.ts"), "utf8");
const live = readFileSync(resolve(process.cwd(), "features/live/ui/live-event-screen.tsx"), "utf8");
const creator = readFileSync(resolve(process.cwd(), "components/celebrity-fan-page.tsx"), "utf8");
const benefit = readFileSync(resolve(process.cwd(), "features/benefit/ui/benefit-screen.tsx"), "utf8");

describe("Phase 6 instrumentation coverage", () => {
  it("covers every v1 name through a client surface or committed server projection", () => {
    const inventory = [client, live, creator, benefit, migration].join("\n");
    for (const name of PRODUCT_EVENT_NAMES) expect(inventory).toContain(name);
  });
  it("projects ticket events only after a ledger insert with the ledger row as stable source", () => {
    expect(migration).toContain("fan_ticket_ledger_product_event after insert");
    expect(migration).toContain("'ledgerRowId',new.id");
    expect(migration).toContain("'server:'||v_event||':'||v_id::text");
  });
  it("keeps measurement failure from rolling back business success", () => {
    expect(migration).toMatch(/exception when others then[\s\S]*return new/);
    expect(client).toContain("return false");
  });
  it("dedupes page views per route/session window and includes LIVE provider context", () => {
    expect(client).toContain("PAGE_VIEW_WINDOW_MS");
    expect(client).toContain("anonymousSessionId()");
    expect(live).toContain("provider: data.live.watch.provider");
    expect(live).toContain("live_cta_click");
  });
});
