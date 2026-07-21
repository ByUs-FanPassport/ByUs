import { describe, expectTypeOf, it } from "vitest";

import type { IdentityRepository } from "./identity-repository";

describe("IdentityRepository service boundary", () => {
  it("requires an explicit actor and correlation ID for privileged writes", () => {
    expectTypeOf<IdentityRepository["linkWallet"]>().parameter(1).toMatchTypeOf<{
      actorAppUserId: string;
      correlationId: string;
    }>();
    expectTypeOf<IdentityRepository["setUserStatus"]>().parameter(2).toMatchTypeOf<{
      actorAppUserId: string;
      correlationId: string;
    }>();
  });
});
