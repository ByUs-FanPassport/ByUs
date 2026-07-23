import { describe, expect, it } from "vitest";
import {
  assertProductionLocalEnvironment,
  parseEnvironmentFile,
  productionLocalEnvironment,
  serializeEnvironment,
} from "../../../../scripts/local-production-env.mjs";

const productionSource = {
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-production",
  PRIVY_APP_ID: "privy-production",
  PRIVY_APP_SECRET: "secret-value",
  SUPABASE_URL: "https://gmrykvmtmuaeswpajteq.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  GIWA_CHAIN_ID: "91342",
  GIWA_RPC_URL: "https://rpc.example.com",
  GIWA_EXPLORER_URL: "https://explorer.example.com",
  BYUS_PASSPORT_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
  BYUS_STAMP_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  BYUS_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: "public-vapid",
};

describe("localhost Production environment contract", () => {
  it("forces localhost, Production data, demo Privy Development, and disables test login", () => {
    expect(productionLocalEnvironment(productionSource)).toMatchObject({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "production",
      BYUS_DATA_ENVIRONMENT: "production",
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
      PRIVY_APP_ENVIRONMENT: "development",
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    });
  });

  it("rejects the Dev Supabase project", () => {
    expect(() => productionLocalEnvironment({
      ...productionSource,
      SUPABASE_URL: "https://xcppyedwusirqnfpbtit.supabase.co",
    })).toThrow(/non-production Supabase host/);
  });

  it("rejects placeholder credentials from Vercel Production", () => {
    expect(() => productionLocalEnvironment({
      ...productionSource,
      PRIVY_APP_SECRET: "placeholder",
    })).toThrow(/PRIVY_APP_SECRET/);
  });

  it("round-trips the generated file and verifies the exact contract", () => {
    const expected = productionLocalEnvironment(productionSource);
    const parsed = parseEnvironmentFile(serializeEnvironment(expected));
    expect(assertProductionLocalEnvironment(parsed)).toEqual(expected);
  });

  it("does not expose a credential value in validation errors", () => {
    const credential = "must-never-appear";
    expect(() => productionLocalEnvironment({
      ...productionSource,
      PRIVY_APP_ID: credential,
    })).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(credential) }),
    );
  });
});
