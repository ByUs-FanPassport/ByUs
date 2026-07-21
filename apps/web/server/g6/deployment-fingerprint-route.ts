import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";

export type DeploymentFingerprintDependencies = {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  fingerprint: {
    supabaseUrl: string;
    vercelEnvironment?: string;
    vercelTargetEnvironment?: string;
    vercelUrl?: string;
  };
};

function correlationId(request: Request) {
  const value = request.headers.get("x-correlation-id")?.trim();
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : crypto.randomUUID();
}

export function supabaseProjectRef(url: string): string {
  const host = new URL(url).hostname;
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (!match) throw new Error("SUPABASE_PROJECT_REF_UNAVAILABLE");
  return match[1];
}

export function createDeploymentFingerprintHandler(dependencies: DeploymentFingerprintDependencies) {
  return async function GET(request: Request): Promise<Response> {
    try {
      await dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId: correlationId(request) });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, { status: error.status === 401 ? 401 : 403 });
      return Response.json({ error: { code: "DEPLOYMENT_FINGERPRINT_UNAVAILABLE" } }, { status: 503 });
    }
    try {
      return Response.json({
        projectRef: supabaseProjectRef(dependencies.fingerprint.supabaseUrl),
        deployment: {
          provider: dependencies.fingerprint.vercelUrl ? "vercel" : "unknown",
          environment: dependencies.fingerprint.vercelEnvironment ?? "unknown",
          targetEnvironment: dependencies.fingerprint.vercelTargetEnvironment ?? null,
          host: dependencies.fingerprint.vercelUrl?.split("/")[0] ?? null,
        },
      }, { headers: { "cache-control": "private, no-store", vary: "Authorization" } });
    } catch {
      return Response.json({ error: { code: "DEPLOYMENT_FINGERPRINT_UNAVAILABLE" } }, { status: 503 });
    }
  };
}
