import "server-only";
import type { InstagramLiveRepository } from "./live-repository";
import { fetchInstagramLiveObservation } from "./live-source";
import { tokenBinding } from "./service";
import type { tokenVault } from "./crypto";

export async function syncInstagramLive(deps: {
  repository: InstagramLiveRepository;
  vault: ReturnType<typeof tokenVault>;
  graphVersion: string;
  observe?: typeof fetchInstagramLiveObservation;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const connections = await deps.repository.claim();
  const outcomes: { celebrityId: string; status: string }[] = [];
  // At most 25 claims and five concurrent five-second sources fit inside a 45-second lease.
  for (let offset = 0; offset < connections.length; offset += 5) {
    await Promise.all(connections.slice(offset, offset + 5).map(async (connection) => {
      let observation: Awaited<ReturnType<typeof fetchInstagramLiveObservation>> = { state: "unavailable", observedAt: now().toISOString() };
      try {
        if (Date.parse(connection.token_expires_at) > now().getTime()) {
          const accessToken = deps.vault.open(connection.token_ciphertext, tokenBinding(connection.celebrity_id, connection.identity));
          observation = await (deps.observe ?? fetchInstagramLiveObservation)(
            { userId: connection.identity.user_id, username: connection.identity.username },
            { accessToken, graphVersion: deps.graphVersion, now },
          );
        }
      } catch { /* Storage keeps prior valid proof on failures without extending its timestamp. */ }
      const saved = await deps.repository.finish(connection, observation);
      outcomes.push({ celebrityId: connection.celebrity_id, status: saved ? observation.state : "superseded" });
    }));
  }
  return outcomes;
}
