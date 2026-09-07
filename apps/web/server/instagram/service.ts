import "server-only";
import { InstagramError, type InstagramConnection, type InstagramProvider } from "./model";
import { newSecret, secretHash, tokenVault } from "./crypto";
import type { InstagramRepository } from "./repository";

export const tokenBinding = (celebrityId: string, identity: InstagramConnection["identity"]) => `${celebrityId}:${identity.id}:${identity.user_id}`;

export function createInstagramService(deps: { repository: InstagramRepository; provider: InstagramProvider; vault: ReturnType<typeof tokenVault>; now?: () => number }) {
  const { repository, provider, vault } = deps;
  const now = deps.now ?? Date.now;
  return {
    async callback(code: string, state: string, browser: string) {
      const hash = secretHash(state);
      const browserHash = secretHash(browser);
      const flow = await repository.transition("consume", hash, browserHash);
      if (!flow) throw new Error("Instagram flow unavailable");
      try {
        const { token, identity } = await provider.exchange(code);
        if (identity.username !== flow.expected_username || (flow.expected_user_id && identity.user_id !== flow.expected_user_id)) throw new InstagramError("ACCOUNT_MISMATCH");
        const pending = newSecret();
        const issuedAt = now();
        await repository.transition("pending", hash, browserHash, {
          next_hash: secretHash(pending), identity,
          token_ciphertext: vault.seal(token.accessToken, tokenBinding(flow.celebrity_id, identity)),
          token_issued_at: new Date(issuedAt).toISOString(),
          token_expires_at: new Date(issuedAt + token.expiresIn * 1000).toISOString(),
        });
        return pending;
      } catch (error) {
        await repository.transition("cancel", hash, browserHash).catch(() => undefined);
        throw error;
      }
    },
    async disconnect(celebrityId: string) {
      // Commit local erasure and generation change BEFORE contacting Meta.
      const erased = await repository.disconnect(celebrityId);
      if (!erased?.identity || !erased.token_ciphertext) return { disconnected: true, remoteRevocation: "not_needed" };
      try {
        const token = vault.open(erased.token_ciphertext, tokenBinding(celebrityId, erased.identity));
        await provider.revoke(token, erased.identity.id);
        return { disconnected: true, remoteRevocation: "confirmed" };
      } catch {
        return { disconnected: true, remoteRevocation: "unconfirmed" };
      }
    },
    async sync(celebrityId?: string) {
      const connections = await repository.claimSync(celebrityId);
      const outcomes = [];
      for (const connection of connections) {
        const changes: Record<string, unknown> = {};
        try {
          const expiresAt = Date.parse(connection.token_expires_at);
          if (expiresAt <= now()) throw new InstagramError("REAUTH_REQUIRED");
          const binding = tokenBinding(connection.celebrity_id, connection.identity);
          let token = vault.open(connection.token_ciphertext, binding);
          if (expiresAt - now() < 7 * 86_400_000 && now() - Date.parse(connection.token_issued_at) >= 86_400_000) {
            const refreshed = await provider.refresh(token);
            token = refreshed.accessToken;
            changes.token_ciphertext = vault.seal(token, binding);
            changes.token_issued_at = new Date(now()).toISOString();
            changes.token_expires_at = new Date(now() + refreshed.expiresIn * 1000).toISOString();
          }
          const media = await provider.media(token, connection.identity);
          const saved = await repository.finishSync(connection, { ...changes, media });
          outcomes.push({ celebrityId: connection.celebrity_id, status: saved ? "updated" : "superseded" });
        } catch (error) {
          if (error instanceof InstagramError && error.code === "REAUTH_REQUIRED") {
            await repository.disconnect(connection.celebrity_id, connection.generation);
            outcomes.push({ celebrityId: connection.celebrity_id, status: "reauth_required" });
          } else {
            // Keep refreshed ciphertext even if fetching media failed. Hide old media immediately.
            const saved = await repository.finishSync(connection, { ...changes, error: "MEDIA_UNAVAILABLE" });
            outcomes.push({ celebrityId: connection.celebrity_id, status: saved ? "unavailable" : "superseded" });
          }
        }
      }
      return outcomes;
    },
  };
}
