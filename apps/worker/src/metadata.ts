import type { BlockchainJob, JobPayload } from "./domain.js";
import type { MetadataDocument } from "./ports.js";

// ERC metadata requires a top-level `name`; only person-identifying name fields
// are forbidden. Values are additionally produced from closed enums/slugs.
const forbiddenKeys = new Set(["email", "nickname", "realName", "personalName", "phone", "wallet", "recipient", "entityId"]);

export function renderMetadata(job: BlockchainJob, payload: JobPayload, assetBaseUri: string): MetadataDocument {
  const credential = job.entityType === "passport"
    ? "Fan Passport"
    : `${(payload as Extract<JobPayload, { stampType: string }>).stampType} Stamp`;
  const assetPath = job.entityType === "passport"
    ? `passport/${payload.celebritySlug}.png`
    : `stamp/${(payload as Extract<JobPayload, { stampType: string }>).stampType.toLowerCase()}/${payload.celebritySlug}.png`;
  const document: MetadataDocument = {
    schema: "https://byus.kr/schemas/credential-metadata-v1.json",
    version: 1,
    name: `ByUs ${credential}`,
    description: `A soulbound ByUs ${credential} credential.`,
    image: `${assetBaseUri.replace(/\/$/, "")}/${assetPath}`,
    attributes: [
      { trait_type: "Credential", value: credential },
      { trait_type: "Celebrity", value: payload.celebritySlug },
      { trait_type: "Transferability", value: "Soulbound" },
      { trait_type: "Metadata Version", value: "1" },
    ],
  };
  assertPiiFree(document);
  return document;
}

export function assertPiiFree(value: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (forbiddenKeys.has(key)) throw new Error(`PII field is forbidden in metadata: ${key}`);
        visit(child);
      }
    }
  };
  visit(value);
}
