import { communityStampKinds, WorkerError, type CommunityStampPayloadV1, type EntityType, type JobPayload, type StampPayloadV1 } from "./domain.js";

export const KYAA_CREDENTIAL_ASSET_BASE_URI = "ipfs://bafybeicrvmcnekzfyoktq3kb2rkvy2dvsfxtczs65e2b3sgjehvi4dm3ni/credentials/v2";

const stampImages = { Knowledge: "knowledge", Reservation: "reservation", Attendance: "attendance", Survey: "survey", Membership: "membership" } as const;

export function kyaaCredentialImage(entityType: EntityType, payload: JobPayload, assetBaseUri: string, actionCode?: number): string {
  const base = assetBaseUri.replace(/\/$/, "");
  if (base !== KYAA_CREDENTIAL_ASSET_BASE_URI) {
    throw new WorkerError("UNVERIFIED_CREDENTIAL_ASSETS", "Unverified kyaa image bundle", false);
  }
  let key: string | undefined;
  if (entityType === "passport") key = "passport";
  if (entityType === "reaction") key = "reaction";
  if (entityType === "stamp") {
    key = stampImages[(payload as StampPayloadV1).stampType];
    if (key && actionCode === 4) key = "mission";
  }
  if (entityType === "community_stamp") {
    const kind = (payload as CommunityStampPayloadV1).stampKind;
    if (communityStampKinds.includes(kind)) key = kind;
  }
  if (!key) throw new WorkerError("UNSUPPORTED_CREDENTIAL_IMAGE", "Unsupported kyaa credential image", false);
  return `${base}/${key}.png`;
}
