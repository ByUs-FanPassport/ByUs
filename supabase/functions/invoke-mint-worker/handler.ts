import { signLambdaInvoke } from "./sigv4.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export interface WorkerInvokerEnv {
  cronSecret: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  lambdaFunctionName: string;
  workerEnvironment: "dev" | "prod";
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function equalSecrets(
  actual: string,
  expected: string,
): Promise<boolean> {
  const [leftBuffer, rightBuffer] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(leftBuffer);
  const right = new Uint8Array(rightBuffer);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export function createWorkerInvokerHandler(
  env: WorkerInvokerEnv,
  fetcher: typeof fetch = fetch,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return response(405, { error: "method_not_allowed" });
    }
    const suppliedSecret = request.headers.get("x-byus-cron-secret") ?? "";
    if (!(await equalSecrets(suppliedSecret, env.cronSecret))) {
      return response(401, { error: "unauthorized" });
    }

    const body = JSON.stringify({
      source: "byus.supabase-cron",
      environment: env.workerEnvironment,
    });
    const signed = await signLambdaInvoke({
      region: env.awsRegion,
      functionName: env.lambdaFunctionName,
      body,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
    const invocation = await fetcher(signed.url, {
      method: "POST",
      headers: signed.headers,
      body,
    });
    const detail = await invocation.text();
    if (!invocation.ok || invocation.headers.get("x-amz-function-error")) {
      console.error("mint worker invocation failed", invocation.status, detail);
      return response(502, { error: "worker_invocation_failed" });
    }

    let result: unknown;
    try {
      result = JSON.parse(detail);
    } catch {
      return response(502, { error: "worker_response_invalid" });
    }
    return response(200, {
      ok: true,
      result,
      executedAt: new Date().toISOString(),
    });
  };
}
