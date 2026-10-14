export type CredentialArtworkKey =
  | "passport"
  | "knowledge"
  | "reservation"
  | "attendance"
  | "survey"
  | "membership"
  | "reaction"
  | "mission"
  | "welcome"
  | "first_comment"
  | "subscription"
  | "support"
  | "share"
  | "invite"
  | "daily_checkin";

export function credentialArtworkAsset(key: CredentialArtworkKey) {
  return `/images/credentials/v2/${key}.png`;
}
