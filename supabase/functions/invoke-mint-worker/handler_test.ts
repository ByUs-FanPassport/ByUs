import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createWorkerInvokerHandler } from "./handler.ts";
import { signLambdaInvoke } from "./sigv4.ts";

const env = {
  cronSecret: "c".repeat(32),
  awsAccessKeyId: "AKIDEXAMPLE",
  awsSecretAccessKey: "secret-example",
  awsRegion: "ap-northeast-2",
  lambdaFunctionName: "byus-mint-worker-dev",
  workerEnvironment: "dev" as const,
};

Deno.test("SigV4 signs the exact Lambda Invoke endpoint and payload", async () => {
  const signed = await signLambdaInvoke({
    region: env.awsRegion,
    functionName: env.lambdaFunctionName,
    body: '{"source":"byus.supabase-cron","environment":"dev"}',
    credentials: {
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
    },
    now: new Date("2026-07-21T12:34:56.000Z"),
  });
  assertEquals(
    signed.url,
    "https://lambda.ap-northeast-2.amazonaws.com/2015-03-31/functions/byus-mint-worker-dev/invocations",
  );
  assertEquals(signed.headers["x-amz-date"], "20260721T123456Z");
  assertMatch(
    signed.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260721\/ap-northeast-2\/lambda\/aws4_request,/,
  );
  assertEquals(signed.headers["x-amz-content-sha256"].length, 64);
});

Deno.test("worker invoker rejects missing cron authorization", async () => {
  const handler = createWorkerInvokerHandler(env, () => {
    throw new Error("must not invoke");
  });
  const response = await handler(
    new Request("https://example.test", { method: "POST" }),
  );
  assertEquals(response.status, 401);
});

Deno.test("worker invoker sends the closed invocation contract", async () => {
  let observedBody = "";
  const mockFetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    observedBody = String(init?.body);
    assert(
      String((init?.headers as Record<string, string>).authorization)
        .startsWith("AWS4-HMAC-SHA256"),
    );
    return new Response('{"enabled":false,"claimed":0}', { status: 200 });
  }) as typeof fetch;
  const handler = createWorkerInvokerHandler(env, mockFetch);
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-byus-cron-secret": env.cronSecret },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    observedBody,
    '{"source":"byus.supabase-cron","environment":"dev"}',
  );
  assertEquals((await response.json()).result, { enabled: false, claimed: 0 });
});

Deno.test("worker invoker fails closed on Lambda function errors", async () => {
  const handler = createWorkerInvokerHandler(
    env,
    async () =>
      new Response("failed", {
        status: 200,
        headers: { "x-amz-function-error": "Unhandled" },
      }),
  );
  const response = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-byus-cron-secret": env.cronSecret },
    }),
  );
  assertEquals(response.status, 502);
});
