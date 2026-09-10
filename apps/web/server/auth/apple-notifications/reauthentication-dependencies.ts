import "server-only";

import { loadServerEnv } from "../../config/env";
import { createPrivyNodeReauthenticationResolver } from "../privy-node-verifier";
import { appleLifecycleEnabled, createAppleLifecycleRepository } from "./apple-lifecycle";
import { loadReauthenticationProviderConfig } from "./reauthentication-provider";
import type { ReauthenticationRouteDependencies } from "./reauthentication-route";

export function createReauthenticationDependencies(): ReauthenticationRouteDependencies {
  if (!appleLifecycleEnabled()) throw new Error("Apple lifecycle is not enabled");
  const env = loadServerEnv();
  return {
    config: loadReauthenticationProviderConfig(),
    repository: createAppleLifecycleRepository(),
    resolver: createPrivyNodeReauthenticationResolver({
      appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
      appEnvironment: env.PRIVY_APP_ENVIRONMENT,
      testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
      appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
    }),
  };
}

export function reauthenticationUnavailableResponse(): Response {
  return Response.json({ error: { code: "REAUTHENTICATION_UNAVAILABLE" } }, {
    status: 503, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
