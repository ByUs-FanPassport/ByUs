"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  acquisitionLanding,
  acquisitionTouchSchema,
  classifyAcquisitionChannel,
  readStoredAcquisitionTouch,
  type AcquisitionTouch,
} from "../domain/acquisition-attribution";
import { recordProductEventV1 } from "./product-event-client";
import { useByUsSession } from "@/components/byus-session-provider";

const STORAGE_KEY = "byus.acquisition.session.v1";
const ENTRY_EVALUATED_KEY = "byus.acquisition.entry-evaluated.v1";

function storeTouch(touch: AcquisitionTouch): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(acquisitionTouchSchema.parse(touch)));
}

export function AcquisitionSessionTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const session = useByUsSession();
  const identifiedReady = ready && session.ready && authenticated;
  const ownerId = session.ownerId ?? user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    let touch: AcquisitionTouch | null;
    try {
      touch = readStoredAcquisitionTouch(window.sessionStorage.getItem(STORAGE_KEY));
      if (!touch) {
        if (window.sessionStorage.getItem(ENTRY_EVALUATED_KEY)) return;
        window.sessionStorage.setItem(ENTRY_EVALUATED_KEY, "1");
        const landing = acquisitionLanding(pathname);
        if (!landing) return;
        touch = {
          channel: classifyAcquisitionChannel({
            searchParams,
            referrer: document.referrer,
            siteOrigin: window.location.origin,
          }),
          landing,
          anonymousRecorded: false,
          identifiedRecorded: false,
          eventNonce: window.crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
        };
        storeTouch(touch);
      }
    } catch {
      return;
    }
    if (!ready) return;

    void (async () => {
      if (identifiedReady) {
        if (touch.identifiedRecorded) return;
        const token = await getAccessToken();
        if (cancelled || !token || !ownerId) return;
        const recorded = await recordProductEventV1(
          {
            eventName: "creator_page_view",
            celebrityId: null,
            liveEventId: null,
            missionId: null,
            benefitId: null,
            source: touch.anonymousRecorded
              ? "acquisition.identified_handoff"
              : "acquisition.session_landing",
            idempotencyKey: `acquisition:identified:${touch.eventNonce}`,
            occurredAt: touch.occurredAt,
            properties: {
              channel: touch.channel,
              landing: touch.landing,
              attribution: "session_first_touch",
            },
          },
          token,
        );
        if (!cancelled && recorded) storeTouch({ ...touch, identifiedRecorded: true });
        return;
      }

      if (touch.anonymousRecorded) return;
      const recorded = await recordProductEventV1({
        eventName: "creator_page_view",
        celebrityId: null,
        liveEventId: null,
        missionId: null,
        benefitId: null,
        source: "acquisition.session_landing",
        idempotencyKey: `acquisition:anonymous:${touch.eventNonce}`,
        occurredAt: touch.occurredAt,
        properties: {
          channel: touch.channel,
          landing: touch.landing,
          attribution: "session_first_touch",
        },
      });
      if (!cancelled && recorded) storeTouch({ ...touch, anonymousRecorded: true });
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [getAccessToken, identifiedReady, ownerId, pathname, ready, searchParams, session.generation]);

  return null;
}
