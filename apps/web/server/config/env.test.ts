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
  NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: "false",
  NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  PRIVY_APP_SECRET: "privy-app-secret-value",
  BYUS_DATA_ENVIRONMENT: "development",
  PRIVY_APP_ENVIRONMENT: "development",
  PRIVY_APPLE_LOGIN_ENABLED: "false",
  PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
  GIWA_CHAIN_ID: "91342",
  GIWA_RPC_URL: "https://sepolia-rpc.giwa.io",
  GIWA_EXPLORER_URL: "https://sepolia-explorer.giwa.io",
  BYUS_PASSPORT_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
  BYUS_STAMP_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
  BYUS_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
  KAKAO_OAUTH_MODE: "test_sink",
  KAKAO_CLIENT_ID: "",
  KAKAO_CLIENT_SECRET: "",
  KAKAO_REDIRECT_URI: "",
  KAKAO_TEST_SINK_SECRET: "",
  KAKAO_ALIMTALK_ENROLLMENT_ENABLED: "false",
  SOLAPI_WEBHOOK_SECRET: "",
  TELEGRAM_BUG_REPORT_BOT_TOKEN: "",
  TELEGRAM_BUG_REPORT_WEBHOOK_SECRET: "",
  TELEGRAM_BUG_REPORT_OPERATOR_SECRET: "",
  CHZZK_CLIENT_ID: "",
  CHZZK_CLIENT_SECRET: "",
  CHZZK_LIVE_ENABLED: "false",
  YOUTUBE_DATA_API_KEY: "",
  VERCEL_ANALYTICS_TOKEN: "",
  VERCEL_ANALYTICS_PROJECT_ID: "",
  VERCEL_ANALYTICS_TEAM_ID: "",
  PHONE_SMS_ENROLLMENT_MODE: "disabled",
  PHONE_SMS_SOLAPI_API_KEY: "",
  PHONE_SMS_SOLAPI_API_SECRET: "",
  PHONE_SMS_SENDER: "",
  PHONE_SMS_OTP_SECRET: "",
  GOOGLE_SITE_VERIFICATION: "",
  GOOGLE_TRANSLATION_API_KEY: "",
  NAVER_SITE_VERIFICATION: "",
  BING_SITE_VERIFICATION: "",
} as const;

describe("public environment", () => {
  it("keeps existing deployments backward-compatible and fail-closed", () => {
    const legacy = { ...validEnv } as Record<string, string>;
    delete legacy.NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT;
    delete legacy.NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED;
    delete legacy.NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED;
    delete legacy.PRIVY_APP_ENVIRONMENT;
    delete legacy.PRIVY_APPLE_LOGIN_ENABLED;
    delete legacy.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED;
    expect(parseServerEnv(legacy)).toMatchObject({
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "production",
      NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: false,
      NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
      PRIVY_APP_ENVIRONMENT: "production",
      PRIVY_APPLE_LOGIN_ENABLED: false,
      PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
    });
  });

  it("accepts HTTPS deployment URLs and the explicit localhost HTTP exception", () => {
    expect(parsePublicEnv(validEnv)).toEqual({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_PRIVY_APP_ID: validEnv.NEXT_PUBLIC_PRIVY_APP_ID,
      NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
      NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
      NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: false,
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
  it("keeps CHZZK credentials server-only and requires them when collection is enabled", () => {
    expect(parseServerEnv(validEnv)).toMatchObject({ CHZZK_LIVE_ENABLED: false });
    expect(() => parseServerEnv({ ...validEnv, CHZZK_LIVE_ENABLED: "true" })).toThrowError(/CHZZK_LIVE_ENABLED/);
    const configured = {
      ...validEnv,
      CHZZK_LIVE_ENABLED: "true",
      CHZZK_CLIENT_ID: "d0a97006-cbfa-40c4-ab11-9cade2c44ac1",
      CHZZK_CLIENT_SECRET: "a".repeat(43),
    };
    expect(parseServerEnv(configured)).toMatchObject({ CHZZK_LIVE_ENABLED: true });
    expect(Object.keys(parsePublicEnv(configured)).some((key) => key.startsWith("CHZZK_"))).toBe(false);
  });

  it("keeps Telegram credentials server-only and validates provider-safe secrets", () => {
    const configured = {
      ...validEnv,
      TELEGRAM_BUG_REPORT_BOT_TOKEN: "8135965800:abcdefghijklmnopqrstuvwxyz_ABCDEFGH",
      TELEGRAM_BUG_REPORT_WEBHOOK_SECRET: "webhook_secret_abcdefghijklmnopqrstuvwxyz",
      TELEGRAM_BUG_REPORT_OPERATOR_SECRET: "operator_secret_abcdefghijklmnopqrstuvwxyz",
    };
    expect(parseServerEnv(configured)).toMatchObject({
      TELEGRAM_BUG_REPORT_BOT_TOKEN: configured.TELEGRAM_BUG_REPORT_BOT_TOKEN,
      TELEGRAM_BUG_REPORT_WEBHOOK_SECRET: configured.TELEGRAM_BUG_REPORT_WEBHOOK_SECRET,
      TELEGRAM_BUG_REPORT_OPERATOR_SECRET: configured.TELEGRAM_BUG_REPORT_OPERATOR_SECRET,
    });
    expect(Object.keys(parsePublicEnv(configured)).some((key) => key.startsWith("TELEGRAM_"))).toBe(false);
    expect(() => parseServerEnv({ ...configured, TELEGRAM_BUG_REPORT_WEBHOOK_SECRET: "contains spaces" })).toThrowError(/TELEGRAM_BUG_REPORT_WEBHOOK_SECRET/);
  });

  it("keeps SMS enrollment off by default and requires complete server-only configuration", () => {
    const legacy: Record<string, string> = { ...validEnv };
    for (const key of Object.keys(legacy)) if (key.startsWith("PHONE_SMS_")) delete legacy[key];
    expect(parseServerEnv(legacy).PHONE_SMS_ENROLLMENT_MODE).toBe("disabled");
    expect(() => parseServerEnv({ ...validEnv, PHONE_SMS_ENROLLMENT_MODE: "solapi" })).toThrowError(/PHONE_SMS_ENROLLMENT_MODE/);
    const configured = { ...validEnv, PHONE_SMS_ENROLLMENT_MODE: "solapi", PHONE_SMS_SOLAPI_API_KEY: "provider-key", PHONE_SMS_SOLAPI_API_SECRET: "provider-secret", PHONE_SMS_SENDER: "01012345678", PHONE_SMS_OTP_SECRET: "x".repeat(32) };
    expect(parseServerEnv(configured).PHONE_SMS_ENROLLMENT_MODE).toBe("solapi");
    expect(Object.keys(parsePublicEnv(configured)).some((key) => key.includes("SMS"))).toBe(false);
    expect(() => parseServerEnv({ ...configured, PHONE_SMS_OTP_SECRET: "short" })).toThrow();
    expect(() => parseServerEnv({ ...configured, PHONE_SMS_SENDER: "+821012345678" })).toThrow();
  });
  it("covers every key declared by .env.example", () => {
    const exampleKeys = readFileSync(resolve(process.cwd(), ".env.example"), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
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

  it("keeps Kakao fail-closed in test sink and requires complete provider configuration", () => {
    expect(parseServerEnv(validEnv)).toMatchObject({ KAKAO_OAUTH_MODE: "test_sink" });
    expect(() => parseServerEnv({ ...validEnv, KAKAO_OAUTH_MODE: "provider" })).toThrowError(/KAKAO_OAUTH_MODE/);
    expect(parseServerEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: "https://dev.byus.test", KAKAO_OAUTH_MODE: "provider", KAKAO_CLIENT_ID: "client", KAKAO_CLIENT_SECRET: "secret", KAKAO_REDIRECT_URI: "https://dev.byus.test/settings/kakao/callback" })).toMatchObject({ KAKAO_OAUTH_MODE: "provider" });
  });

  it.each([
    "https://dev.byus.test/api/me/connected-accounts/kakao/callback",
    "https://other.test/settings/kakao/callback",
    "https://dev.byus.test/settings/kakao/callback?locale=ko",
    "https://dev.byus.test/settings/kakao/callback#done",
    "http://dev.byus.test/settings/kakao/callback",
  ])("rejects an unsafe or obsolete Kakao browser callback: %s", (KAKAO_REDIRECT_URI) => {
    expect(() => parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_APP_URL: "https://dev.byus.test",
      KAKAO_OAUTH_MODE: "provider",
      KAKAO_CLIENT_ID: "client",
      KAKAO_CLIENT_SECRET: "secret",
      KAKAO_REDIRECT_URI,
    })).toThrowError(/KAKAO_REDIRECT_URI/);
  });

  it("accepts the exact localhost callback over HTTP", () => {
    expect(parseServerEnv({
      ...validEnv,
      KAKAO_OAUTH_MODE: "provider",
      KAKAO_CLIENT_ID: "client",
      KAKAO_CLIENT_SECRET: "secret",
      KAKAO_REDIRECT_URI: "http://localhost:3000/settings/kakao/callback",
    })).toMatchObject({ KAKAO_REDIRECT_URI: "http://localhost:3000/settings/kakao/callback" });
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
        !key.startsWith("KAKAO_") &&
        !key.startsWith("PHONE_SMS_") &&
        !key.startsWith("VERCEL_ANALYTICS_") &&
        key !== "YOUTUBE_DATA_API_KEY" &&
        key !== "GOOGLE_TRANSLATION_API_KEY" &&
        !key.startsWith("CHZZK_") &&
        key !== "SOLAPI_WEBHOOK_SECRET" &&
        !key.startsWith("TELEGRAM_BUG_REPORT_") &&
        !key.endsWith("_SITE_VERIFICATION") &&
        key !== "PRIVY_APP_ENVIRONMENT" &&
        key !== "PRIVY_APPLE_LOGIN_ENABLED" &&
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

  it("enables Apple login only when matching client and server flags are explicit", () => {
    expect(parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: "true",
      PRIVY_APPLE_LOGIN_ENABLED: "true",
    })).toMatchObject({
      NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: true,
      PRIVY_APPLE_LOGIN_ENABLED: true,
    });

    expect(() => parseServerEnv({
      ...validEnv,
      NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: "true",
    })).toThrowError(/PRIVY_APPLE_LOGIN_ENABLED/);
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
