import "server-only";
import { z } from "zod";

export function loadInstagramConfig(source: Record<string, string | undefined> = process.env, allowDisabled = false) {
  if (!allowDisabled && source.INSTAGRAM_INTEGRATION_ENABLED !== "true") throw new Error("Instagram integration disabled");
  const config = z.object({
    INSTAGRAM_APP_ID: z.string().regex(/^\d+$/),
    INSTAGRAM_APP_SECRET: z.string().min(16),
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: z.string().min(1),
    INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.0$/),
    INSTAGRAM_APP_ORIGIN: z.string().url(),
    INSTAGRAM_REMOTE_REVOCATION_VERIFIED: z.enum(["true", "false"]).default("false"),
  }).parse(source);
  const origin = new URL(config.INSTAGRAM_APP_ORIGIN);
  if (origin.origin !== config.INSTAGRAM_APP_ORIGIN || origin.username || origin.password
    || (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "localhost"))) throw new Error("Invalid Instagram origin");
  const key = Buffer.from(config.INSTAGRAM_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32 || key.toString("base64") !== config.INSTAGRAM_TOKEN_ENCRYPTION_KEY) throw new Error("Invalid Instagram encryption key");
  return {
    appId: config.INSTAGRAM_APP_ID, appSecret: config.INSTAGRAM_APP_SECRET,
    encryptionKey: config.INSTAGRAM_TOKEN_ENCRYPTION_KEY, graphVersion: config.INSTAGRAM_GRAPH_VERSION,
    origin: origin.origin, redirectUri: `${origin.origin}/connect/instagram/callback`,
    remoteRevocationVerified: config.INSTAGRAM_REMOTE_REVOCATION_VERIFIED === "true",
  };
}
export type InstagramConfig = ReturnType<typeof loadInstagramConfig>;
