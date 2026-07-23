import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EnvironmentValidationError,
  parsePublicEnv,
  parseServerEnv,
} from "./env";

const validEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
  NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
  NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  PRIVY_APP_SECRET: "privy-app-secret-value",
  BYUS_DATA_ENVIRONMENT: "development",
  PRIVY_APP_ENVIRONMENT: "development",
  PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
  GIWA_CHAIN_ID: "91342",
  GIWA_RPC_URL: "https://sepolia-rpc.giwa.io",
  GIWA_EXPLORER_URL: "https://sepolia-explorer.giwa.io",
  BYUS_PASSPORT_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
  BYUS_STAMP_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  BYUS_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
} as const;

describe("public environment", () => {
  it("keeps existing deployments backward-compatible and fail-closed", () => {
    const legacy = { ...validEnv } as Record<string, string>;
    delete legacy.NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT;
    delete legacy.NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED;
    delete legacy.PRIVY_APP_ENVIRONMENT;
    delete legacy.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED;
    expect(parseServerEnv(legacy)).toMatchObject({
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "production",
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
      PRIVY_APP_ENVIRONMENT: "production",
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
    });
  });

  it("accepts HTTPS deployment URLs and the explicit localhost HTTP exception", () => {
    expect(parsePublicEnv(validEnv)).toEqual({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_PRIVY_APP_ID: validEnv.NEXT_PUBLIC_PRIVY_APP_ID,
      NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
    });
    expect(
      parsePublicEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: "https://staging.byus.vercel.app" }),
    ).toMatchObject({ NEXT_PUBLIC_APP_URL: "https://staging.byus.vercel.app" });
  });

  it.each(["http://byus.kr", "ftp://byus.kr", "not-a-url"])(
    "rejects a non-HTTPS non-localhost app URL: %s",
    (NEXT_PUBLIC_APP_URL) => {
      expect(() => parsePublicEnv({ ...validEnv, NEXT_PUBLIC_APP_URL })).toThrow(
        EnvironmentValidationError,
      );
    },
  );

  it("fails closed when a required public value is absent", () => {
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL }),
    ).toThrowError(/NEXT_PUBLIC_PRIVY_APP_ID/);
  });

  it("rejects an empty public Privy app ID", () => {
    expect(() => parsePublicEnv({ ...validEnv, NEXT_PUBLIC_PRIVY_APP_ID: "   " })).toThrowError(
      /NEXT_PUBLIC_PRIVY_APP_ID/,
    );
  });
});

describe("server environment", () => {
  it("covers every key declared by .env.example", () => {
    const exampleKeys = readFileSync(resolve(process.cwd(), ".env.example"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=", 1)[0])
      .sort();

    expect(Object.keys(validEnv).sort()).toEqual(exampleKeys);
  });

  it("parses every canonical value and coerces the fixed GIWA chain ID", () => {
    expect(parseServerEnv(validEnv)).toMatchObject({
      GIWA_CHAIN_ID: 91342,
      PRIVY_APP_ID: validEnv.PRIVY_APP_ID,
    });
  });

  it("accepts localhost with Production data and the demo Privy Development app", () => {
    expect(parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "production",
      BYUS_DATA_ENVIRONMENT: "production",
      SUPABASE_URL: "https://gmrykvmtmuaeswpajteq.supabase.co",
    })).toMatchObject({
      BYUS_DATA_ENVIRONMENT: "production",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });

  it("rejects a Dev Supabase project with Production data", () => {
    const productionBase = {
      ...validEnv,
      NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "production",
      BYUS_DATA_ENVIRONMENT: "production",
    };
    expect(() => parseServerEnv({
      ...productionBase,
      SUPABASE_URL: "https://xcppyedwusirqnfpbtit.supabase.co",
    })).toThrowError(/SUPABASE_URL/);
  });

  it("fails for every missing canonical server value", () => {
    const serverKeys = Object.keys(validEnv).filter(
      (key) =>
        !key.startsWith("NEXT_PUBLIC_") &&
        key !== "PRIVY_APP_ENVIRONMENT" &&
        key !== "PRIVY_TEST_ACCOUNT_LOGIN_ENABLED",
    );

    for (const key of serverKeys) {
      const source: Record<string, string | undefined> = { ...validEnv };
      delete source[key];
      expect(() => parseServerEnv(source), key).toThrow(EnvironmentValidationError);
    }
  });

  it.each(["1", "91341", "91343", "not-a-chain"])(
    "rejects any chain other than GIWA Sepolia 91342: %s",
    (GIWA_CHAIN_ID) => {
      expect(() => parseServerEnv({ ...validEnv, GIWA_CHAIN_ID })).toThrowError(
        /GIWA_CHAIN_ID/,
      );
    },
  );

  it.each(["GIWA_RPC_URL", "GIWA_EXPLORER_URL", "SUPABASE_URL"])(
    "requires HTTPS for %s",
    (key) => {
      expect(() => parseServerEnv({ ...validEnv, [key]: "http://insecure.example.com" })).toThrow(
        EnvironmentValidationError,
      );
    },
  );

  it.each(["PRIVY_APP_SECRET", "SUPABASE_SERVICE_ROLE_KEY"])(
    "rejects an empty or malformed server credential %s",
    (key) => {
    expect(() => parseServerEnv({ ...validEnv, [key]: "   " })).toThrow(
      EnvironmentValidationError,
    );
    },
  );

  it("requires the public and server Privy app IDs to identify the same app", () => {
    expect(() => parseServerEnv({ ...validEnv, PRIVY_APP_ID: "different-app" })).toThrowError(
      /PRIVY_APP_ID/,
    );
  });

  it("enables Test Account login only for matching non-production client and server policy", () => {
    expect(parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
    })).toMatchObject({ PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: true });

    expect(() => parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_APP_URL: "https://byus.kr",
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
    })).toThrowError(/NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED/);
    expect(() => parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "production",
      PRIVY_APP_ENVIRONMENT: "production",
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
    })).toThrowError(/NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED/);
    expect(() => parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "true",
    })).toThrowError(/PRIVY_TEST_ACCOUNT_LOGIN_ENABLED/);
  });

  it.each([
    ["BYUS_PASSPORT_CONTRACT_ADDRESS", "0x1234"],
    ["BYUS_STAMP_CONTRACT_ADDRESS", "not-an-address"],
    ["BYUS_RELAYER_ADDRESS", "0X3333333333333333333333333333333333333333"],
  ])("rejects malformed blockchain credential %s", (key, value) => {
    expect(() => parseServerEnv({ ...validEnv, [key]: value })).toThrow(
      EnvironmentValidationError,
    );
  });

  it.each([
    "VITE_PRIVY_APP_ID",
    "PRIVY_SECRET",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "RELAYER_PRIVATE_KEY",
    "GIWA_RELAYER_PRIVATE_KEY",
    "PINATA_JWT",
    "PINATA_GATEWAY_URL",
    "AWS_S3_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ])("rejects forbidden worker secret or legacy alias %s", (forbiddenKey) => {
    expect(() => parseServerEnv({ ...validEnv, [forbiddenKey]: "legacy-value" })).toThrowError(
      new RegExp(forbiddenKey),
    );
  });

  it("never includes a secret value in validation errors", () => {
    const secret = "must-never-appear-in-errors";
    try {
      parseServerEnv({ ...validEnv, AWS_SECRET_ACCESS_KEY: secret });
      throw new Error("Expected environment validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
