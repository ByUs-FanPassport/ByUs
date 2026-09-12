import "server-only";
import type { InstagramProvider } from "./model";
import { newSecret,secretHash,tokenVault } from "./crypto";
import { tokenBinding } from "./service";
import type { InstagramOwnerRepository } from "./owner-repository";

export function createInstagramOwnerService(deps:{repository:InstagramOwnerRepository;provider:InstagramProvider;vault:ReturnType<typeof tokenVault>;now?:()=>number}){
  const now = deps.now ?? Date.now;
  return {
    async callback(code: string, state: string, browser: string) {
      const hash = secretHash(state);
      const browserHash = secretHash(browser);
      await deps.repository.transition("consume", hash, null, browserHash);
      try {
        const { token, identity } = await deps.provider.exchange(code);
        const target = await deps.repository.transition("resolve", hash, null, browserHash, { identity });
        if (!target.celebrity_id) throw new Error("Instagram owner mapping unavailable");
        const pending = newSecret();
        const issued = now();
        await deps.repository.transition("pending", hash, null, browserHash, {
          next_hash: secretHash(pending), identity,
          token_ciphertext: deps.vault.seal(token.accessToken, tokenBinding(target.celebrity_id, identity)),
          token_issued_at: new Date(issued).toISOString(),
          token_expires_at: new Date(issued + token.expiresIn * 1000).toISOString(),
        });
        return pending;
      } catch (error) {
        await deps.repository.transition("cancel", hash, null, browserHash).catch(() => undefined);
        throw error;
      }
    },
    async disconnect(actor: string, celebrityId: string, generation: string) {
      const erased = await deps.repository.disconnect(actor, celebrityId, generation);
      if (!erased.identity || !erased.token_ciphertext) {
        return { disconnected: true as const, remoteRevocation: "not_needed" as const };
      }
      try {
        const token = deps.vault.open(erased.token_ciphertext, tokenBinding(celebrityId, erased.identity));
        await deps.provider.revoke(token, erased.identity.id);
        return { disconnected: true as const, remoteRevocation: "confirmed" as const };
      } catch {
        return { disconnected: true as const, remoteRevocation: "unconfirmed" as const };
      }
    },
  };
}
