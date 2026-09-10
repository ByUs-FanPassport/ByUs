import { describe, expect, it } from "vitest";
import { availableCreatorRoles, creatorRoleLabel, creatorRoleFilterLabel, creatorRolesSchema, matchesCreatorRole, parseCreatorRoleFilter, withRepresentativeRole } from "./creator-role";

describe("creator roles", () => {
  it.each([undefined, null, [], ["artist", "artist"], ["host"], ["artist", "creator", "show_host", "artist"]])("rejects incomplete or invalid roles %j", (roles) => {
    expect(creatorRolesSchema.safeParse(roles).success).toBe(false);
  });
  it("matches secondary activities and only offers populated categories", () => {
    const people = [{ roles: creatorRolesSchema.parse(["creator", "artist"]) }];
    expect(matchesCreatorRole(people[0].roles, "artist")).toBe(true);
    expect(matchesCreatorRole(people[0].roles, "show_host")).toBe(false);
    expect(availableCreatorRoles(people)).toEqual(["artist", "creator"]);
  });
  it("promotes a representative without losing or repeating activities", () => {
    expect(withRepresentativeRole(["artist", "creator"], "creator")).toEqual(["creator", "artist"]);
    expect(withRepresentativeRole(["artist", "creator"], "show_host")).toEqual(["show_host", "artist", "creator"]);
  });
  it("parses URL input conservatively and uses localized singular/card and plural/filter labels", () => {
    expect(parseCreatorRoleFilter("show_host")).toBe("show_host");
    expect(parseCreatorRoleFilter(["artist", "creator"])).toBe("all");
    expect(parseCreatorRoleFilter("host")).toBe("all");
    expect(creatorRoleLabel("show_host", "ko")).toBe("쇼호스트");
    expect(creatorRoleLabel("show_host", "en")).toBe("Show host");
    expect(creatorRoleFilterLabel("show_host", "en")).toBe("Show hosts");
  });
});
