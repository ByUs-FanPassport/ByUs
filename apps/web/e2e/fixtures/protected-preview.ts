import { expect, request as playwrightRequest, test as base } from "@playwright/test";

const APPROVED_LINKED_DEV_ORIGIN = "https://byus-dev.vercel.app";

export const test = base.extend({
  request: async ({ baseURL, context }, provide) => {
    const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    if (!secret) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required");
    if (baseURL?.replace(/\/$/, "") !== APPROVED_LINKED_DEV_ORIGIN) {
      throw new Error("E2E_DEPLOYMENT_BINDING_MISMATCH");
    }

    const protectedRequest = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        "x-vercel-protection-bypass": secret,
        "x-vercel-set-bypass-cookie": "true",
      },
    });
    const bootstrap = await protectedRequest.get("/");
    if (!bootstrap.ok()) {
      await protectedRequest.dispose();
      throw new Error(`VERCEL_BYPASS_BOOTSTRAP_FAILED: HTTP ${bootstrap.status()}`);
    }

    const storage = await protectedRequest.storageState();
    const approvedCookies = storage.cookies.filter((cookie) => cookie.domain === "byus-dev.vercel.app");
    if (approvedCookies.length === 0) {
      await protectedRequest.dispose();
      throw new Error("VERCEL_BYPASS_COOKIE_MISSING");
    }
    await context.addCookies(approvedCookies);

    try {
      await provide(protectedRequest);
    } finally {
      await protectedRequest.dispose();
    }
  },
});

export { expect };
