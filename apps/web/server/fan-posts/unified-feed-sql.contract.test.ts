import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261009100000_unified_creator_feed.sql"), "utf8");
const behavior = readFileSync(resolve(process.cwd(), "../../supabase/tests/unified_creator_feed.sql"), "utf8");

describe("unified creator feed SQL", () => {
  it("filters every source for viewer visibility before the shared page limit", () => {
    const visible = sql.slice(sql.indexOf("visible as materialized"), sql.indexOf("candidates as materialized"));
    expect(visible).toContain("fan_web_content_target(p_app_user_id,'notice'");
    expect(visible).toContain("fan_web_content_target(p_app_user_id,'fan_post'");
    expect(visible).toContain("fan_web_content_target(p_app_user_id,'cheer'");
    expect(visible).not.toContain(" limit ");
  });

  it("keeps welcome and pinned notices ahead of a deterministic mixed cursor", () => {
    expect(sql).toContain("case when n.pinned and n.notice_kind='standard' then 2 when n.pinned then 1 else 0 end");
    expect(sql).toContain("(pin_rank,occurred_at,item_kind,id)<(p_before_rank,p_before_at,p_before_kind,p_before_id)");
    expect(sql).toContain("order by pin_rank desc,occurred_at desc,item_kind desc,id desc");
    expect(sql).toContain("'commentCount',(select count(*)");
  });

  it("ships a rollback-safe behavior test for private, blocked, locale, and cursor reads", () => {
    expect(behavior).toContain("begin;");
    expect(behavior).toContain("rollback;");
    expect(behavior).toContain("visibility was applied after limit");
    expect(behavior).toContain("private or blocked row leaked");
    expect(behavior).toContain("official locale/subtype");
  });
});
