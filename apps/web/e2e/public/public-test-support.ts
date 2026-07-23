import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

type ExternalFailure = Readonly<{
  kind: "response" | "requestfailed";
  method: string;
  resource: string;
  status?: number;
  failure?: string;
}>;

type BrowserError = Readonly<{
  detail: string;
  sourceUrl?: string;
}>;

function safeResource(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function isPrivyAuth(value: string): boolean {
  try {
    return new URL(value).hostname === "auth.privy.io";
  } catch {
    return value.includes("auth.privy.io");
  }
}

export function observeBrowserErrors(page: Page) {
  const browserErrors: BrowserError[] = [];
  const externalFailures: ExternalFailure[] = [];

  page.on("pageerror", (error) => {
    browserErrors.push({ detail: `pageerror: ${error.stack || error.message}` });
  });
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    browserErrors.push({
      detail: `console.error: ${message.text()}`,
      sourceUrl: message.location().url || undefined,
    });
  });
  page.on("response", (response: Response) => {
    if (!isPrivyAuth(response.url()) || response.status() !== 403) return;
    externalFailures.push({
      kind: "response",
      method: response.request().method(),
      resource: safeResource(response.url()),
      status: response.status(),
    });
  });
  page.on("requestfailed", (request: Request) => {
    if (!isPrivyAuth(request.url())) return;
    externalFailures.push({
      kind: "requestfailed",
      method: request.method(),
      resource: safeResource(request.url()),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });

  return {
    result() {
      const externalErrors = browserErrors
        .filter(
          ({ detail, sourceUrl }) =>
            (sourceUrl ? isPrivyAuth(sourceUrl) : false)
            || detail.includes("auth.privy.io")
            || (
              detail.includes("Content-Security-Policy")
              && detail.includes("blocked a JavaScript eval")
              && detail.includes("Missing 'unsafe-eval'")
            ),
        )
        .map(({ detail }) => detail);
      const firstPartyErrors = browserErrors
        .map(({ detail }) => detail)
        .filter((detail) => !externalErrors.includes(detail));
      return { externalErrors, externalFailures, firstPartyErrors };
    },
  };
}

export function requireEvidenceRunId(): string {
  const runId = process.env.BYUS_E2E_RUN_ID?.trim();
  if (!runId) throw new Error("BYUS_E2E_RUN_ID is required for public evidence");
  return runId;
}
