import "server-only";

import { z } from "zod";

type EnvironmentSource = Record<string, string | undefined>;

const FORBIDDEN_ENV_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PASSPORT_CONTRACT_ADDRESS",
  "AWS_ACCESS_KEY_ID",
  "AWS_S3_BUCKET",
  "AWS_SECRET_ACCESS_KEY",
  "GIWA_RELAYER_PRIVATE_KEY",
  "PINATA_GATEWAY_URL",
  "PINATA_JWT",
  "PRIVY_SECRET",
  "RELAYER_PRIVATE_KEY",
  "STAMP_CONTRACT_ADDRESS",
  "SUPABASE_ANON_KEY",
]);

const evmAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a canonical 0x-prefixed EVM address");

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSecureAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return false;
    }
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

const httpsUrl = z.string().trim().refine(isHttpsUrl, "must be an HTTPS URL");
const booleanFlag = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
const privyAppEnvironment = z.enum(["development", "production"]).default("production");

function isProductionHostname(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "byus.kr" || hostname === "www.byus.kr";
  } catch {
    return false;
  }
}

const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: z
      .string()
      .trim()
      .refine(isSecureAppUrl, "must be HTTPS, except for an HTTP localhost app URL"),
    NEXT_PUBLIC_PRIVY_APP_ID: z.string().trim().min(1),
    NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: privyAppEnvironment,
    NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: booleanFlag,
  })
  .superRefine((value, context) => {
    if (
      value.NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED &&
      (value.NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT !== "development" ||
        isProductionHostname(value.NEXT_PUBLIC_APP_URL))
    ) {
      context.addIssue({
        code: "custom",
        message: "Privy Test Account login is restricted to a non-production Privy app and URL",
        path: ["NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED"],
      });
    }
  });

const serverEnvSchema = publicEnvSchema
  .extend({
    PRIVY_APP_ID: z.string().trim().min(1),
    PRIVY_APP_SECRET: z.string().trim().min(8),
    PRIVY_APP_ENVIRONMENT: privyAppEnvironment,
    PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: booleanFlag,
    SUPABASE_URL: httpsUrl,
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(16),
    GIWA_CHAIN_ID: z.coerce.number().int().refine((value) => value === 91342),
    GIWA_RPC_URL: httpsUrl,
    GIWA_EXPLORER_URL: httpsUrl,
    BYUS_PASSPORT_CONTRACT_ADDRESS: evmAddress,
    BYUS_STAMP_CONTRACT_ADDRESS: evmAddress,
    BYUS_RELAYER_ADDRESS: evmAddress,
  })
  .superRefine((value, context) => {
    if (value.PRIVY_APP_ID !== value.NEXT_PUBLIC_PRIVY_APP_ID) {
      context.addIssue({
        code: "custom",
        message: "must match NEXT_PUBLIC_PRIVY_APP_ID",
        path: ["PRIVY_APP_ID"],
      });
    }
    if (value.PRIVY_APP_ENVIRONMENT !== value.NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT) {
      context.addIssue({
        code: "custom",
        message: "must match NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT",
        path: ["PRIVY_APP_ENVIRONMENT"],
      });
    }
    if (
      value.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED !==
      value.NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED
    ) {
      context.addIssue({
        code: "custom",
        message: "must match NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED",
        path: ["PRIVY_TEST_ACCOUNT_LOGIN_ENABLED"],
      });
    }
  });

export type PublicEnvironment = z.infer<typeof publicEnvSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvSchema>;

export class EnvironmentValidationError extends Error {
  readonly invalidKeys: readonly string[];

  constructor(invalidKeys: readonly string[]) {
    const keys = [...new Set(invalidKeys)].sort();
    super(`Invalid environment variables: ${keys.join(", ")}`);
    this.name = "EnvironmentValidationError";
    this.invalidKeys = keys;
  }
}

function findForbiddenKeys(source: EnvironmentSource): string[] {
  return Object.keys(source).filter(
    (key) => key.startsWith("VITE_") || FORBIDDEN_ENV_KEYS.has(key),
  );
}

function parseEnvironment<T>(
  schema: z.ZodType<T>,
  source: EnvironmentSource,
): T {
  const forbiddenKeys = findForbiddenKeys(source);
  if (forbiddenKeys.length > 0) {
    throw new EnvironmentValidationError(forbiddenKeys);
  }

  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentValidationError(
      result.error.issues.map((issue) => String(issue.path[0] ?? "environment")),
    );
  }
  return result.data;
}

export function parsePublicEnv(source: EnvironmentSource): PublicEnvironment {
  return parseEnvironment(publicEnvSchema, source);
}

export function parseServerEnv(source: EnvironmentSource): ServerEnvironment {
  return parseEnvironment(serverEnvSchema, source);
}

export function loadServerEnv(): ServerEnvironment {
  return parseServerEnv(process.env);
}
