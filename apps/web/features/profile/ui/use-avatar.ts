"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { avatarResponseSchema, type Avatar } from "../domain/avatar";
import { subscribeAvatarChanged } from "./avatar-events";

type AvatarState =
  | { status: "loading" }
  | { status: "ready"; avatar: Avatar; imageUrl: string | null }
  | { status: "error" };

type Snapshot = { key: string; state: AvatarState };

/** Loads private avatar images without ever sharing a previous owner's blob URL. */
export function useAvatar() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const ownerId = user?.id;
  const key = `${ready}:${authenticated}:${ownerId ?? ""}`;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const refreshRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!ready || !authenticated || !ownerId) return;
    let active = true;
    let inFlight = false;
    let requestedAgain = false;
    let controller: AbortController | null = null;
    let currentImageUrl: string | null = null;

    const publish = (state: AvatarState) => {
      if (active) setSnapshot({ key, state });
    };
    const revokeCurrentImage = () => {
      if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
      currentImageUrl = null;
    };
    const load = async () => {
      if (!active) return;
      if (inFlight) {
        requestedAgain = true;
        return;
      }
      inFlight = true;
      controller = new AbortController();
      try {
        const token = await getAccessToken();
        if (!active || !token) {
          if (active) publish({ status: "error" });
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };
        const metadataResponse = await fetch("/api/me/avatar", {
          headers,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!metadataResponse.ok) throw new Error("avatar metadata unavailable");
        const { avatar } = avatarResponseSchema.parse(await metadataResponse.json());
        if (!active) return;

        let nextImageUrl: string | null = null;
        if (avatar.hasImage) {
          try {
            const imageResponse = await fetch(
              `/api/me/avatar/image?revision=${avatar.revision}`,
              { headers, cache: "no-store", signal: controller.signal },
            );
            if (imageResponse.ok) {
              const blob = await imageResponse.blob();
              if (active) nextImageUrl = URL.createObjectURL(blob);
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
          }
        }
        if (!active) {
          if (nextImageUrl) URL.revokeObjectURL(nextImageUrl);
          return;
        }
        revokeCurrentImage();
        currentImageUrl = nextImageUrl;
        publish({ status: "ready", avatar, imageUrl: nextImageUrl });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          publish({ status: "error" });
        }
      } finally {
        inFlight = false;
        if (active && requestedAgain) {
          requestedAgain = false;
          void load();
        }
      }
    };

    refreshRef.current = () => void load();
    const unsubscribe = subscribeAvatarChanged(ownerId, () => void load());
    publish({ status: "loading" });
    void load();
    return () => {
      active = false;
      controller?.abort();
      revokeCurrentImage();
      unsubscribe();
      refreshRef.current = () => undefined;
    };
  }, [authenticated, getAccessToken, key, ownerId, ready]);

  const state: AvatarState =
    !ready || (authenticated && snapshot?.key !== key)
      ? { status: "loading" }
      : !authenticated || !ownerId
        ? { status: "error" }
        : snapshot?.state ?? { status: "loading" };

  return { state, refresh, ownerId, getAccessToken };
}
