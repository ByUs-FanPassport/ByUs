const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function equalSecrets(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }

  const expectedSecret = Deno.env.get("BYUS_CRON_SECRET");
  const suppliedSecret = request.headers.get("x-byus-cron-secret") ?? "";
  if (!expectedSecret || !(await equalSecrets(suppliedSecret, expectedSecret))) {
    return response(401, { error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, { error: "environment_not_configured" });
  }

  const rpcResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/reclaim_stale_blockchain_jobs`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );

  if (!rpcResponse.ok) {
    const detail = await rpcResponse.text();
    console.error("queue maintenance RPC failed", rpcResponse.status, detail);
    return response(502, { error: "queue_maintenance_failed" });
  }

  const reclaimed = await rpcResponse.json();
  return response(200, {
    ok: true,
    reclaimed,
    executedAt: new Date().toISOString(),
  });
});
