"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { communityStampCollectionSchema, type CommunityStampCollection } from "../domain/community-stamps";
const parse = (value: unknown) => communityStampCollectionSchema.parse(value);
const pending = (data: CommunityStampCollection) => data.stamps.some(stamp => ["queued", "processing", "retryable"].includes(stamp.mint.status));
export function useCommunityStamps(creator?: string) {
  const auth = usePrivy();
  return useOwnedFanResource(`/api/community-stamps${creator ? `?creator=${encodeURIComponent(creator)}` : ""}`, parse, auth, pending);
}

export async function communityStampAction<T>(getAccessToken: () => Promise<string | null>, action: string, body: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  const response = await fetch(`/api/community-stamps/${action}`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.code ?? "COMMUNITY_STAMP_UNAVAILABLE");
  return parse(value);
}
