import { describe, expect, it } from "vitest";
import { CREATOR_ROLES, availableCreatorRoles, creatorRoleLabel, creatorRoleFilterLabel, creatorRolesSchema, matchesCreatorRole, parseCreatorRoleFilter } from "./creator-role";

describe("single creator role", () => {
  it.each([undefined, null, [], ["artist"], ["idol", "creator"], ["creator", "creator"], ["host"]])("rejects incomplete, legacy, or multiple roles %j", (roles) => {
    expect(creatorRolesSchema.safeParse(roles).success).toBe(false);
  });

  it.each(CREATOR_ROLES)("accepts one %s role", (role) => {
    expect(creatorRolesSchema.parse([role])).toEqual([role]);
  });

  it("keeps category order and includes only populated primary roles", () => {
    const people = [{ roles: creatorRolesSchema.parse(["creator"]) }, { roles: creatorRolesSchema.parse(["actor"]) }];
    expect(availableCreatorRoles(people)).toEqual(["actor", "creator"]);
    expect(matchesCreatorRole(people[0].roles, "creator")).toBe(true);
    expect(matchesCreatorRole(people[0].roles, "actor")).toBe(false);
    expect(matchesCreatorRole(people[0].roles, "all")).toBe(true);
    expect(CREATOR_ROLES).toEqual(["idol", "singer", "actor", "creator", "show_host"]);
  });

  it("parses old or malformed URLs as all and preserves supported codes", () => {
    for (const role of CREATOR_ROLES) expect(parseCreatorRoleFilter(role)).toBe(role);
    for (const value of ["artist", "host", ["idol", "creator"], null]) {
      expect(parseCreatorRoleFilter(value)).toBe("all");
    }
  });

  it("uses the approved localized category names", () => {
    expect(CREATOR_ROLES.map((role) => creatorRoleLabel(role, "ko"))).toEqual(["아이돌", "가수", "배우", "크리에이터", "쇼호스트"]);
    expect(CREATOR_ROLES.map((role) => creatorRoleFilterLabel(role, "en"))).toEqual(["Idols", "Singers", "Actors", "Creators", "Show hosts"]);
    expect(creatorRoleFilterLabel("all", "ko")).toBe("전체");
  });
});
