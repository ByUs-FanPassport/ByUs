"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { anonymousSessionId } from "./product-event-client";
import { campaignOutboundHref, type banksyDestinations } from "../domain/banksy-campaign";
import styles from "./banksy-campaign.module.css";

const KEY = "byus.banksy.touch.v1";
const touchSchema = z.object({ firstLinkId: z.uuid().nullable(), linkId: z.uuid().nullable(), sequence: z.number().int().min(0).max(1_000_000), visitId: z.uuid().nullable(), recordedSequence: z.number().int().nullable() });
function storedTouch() {
  try { return touchSchema.parse(JSON.parse(sessionStorage.getItem(KEY) ?? "null")); } catch { return null; }
}

export function BanksyVisitTracker() {
  const query = useSearchParams();
  const link = query.get("campaign_link");
  useEffect(() => {
    void (async () => {
      try {
        const parsed = z.uuid().safeParse(link);
        const prior = storedTouch();
        // An internal navigation must not overwrite the latest shared-link touch.
        const linkId = parsed.success ? parsed.data : prior?.linkId ?? null;
        const changed = prior !== null && linkId !== prior.linkId;
        const touch = { firstLinkId: prior ? prior.firstLinkId : linkId, linkId, sequence: (prior?.sequence ?? 0) + (changed ? 1 : 0), visitId: prior?.visitId ?? null, recordedSequence: prior?.recordedSequence ?? null };
        if (prior?.visitId && !changed && prior.recordedSequence === touch.sequence) return;
        sessionStorage.setItem(KEY, JSON.stringify(touch));
        const response = await fetch("/api/campaigns/banksy/visit", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: anonymousSessionId(), firstLinkId: touch.firstLinkId, linkId, sequence: touch.sequence }),
        });
        if (!response.ok) return;
        const result = z.object({ visitId: z.uuid().nullable() }).parse(await response.json());
        const current = storedTouch();
        if (current && current.firstLinkId === touch.firstLinkId && result.visitId) {
          sessionStorage.setItem(KEY, JSON.stringify({ ...current, visitId: result.visitId, recordedSequence: current.sequence === touch.sequence && current.linkId === touch.linkId ? touch.sequence : current.recordedSequence }));
          window.dispatchEvent(new Event("byus-campaign-visit"));
        }
      } catch { /* Storage and measurement failures must never block raffle participation. */ }
    })();
  }, [link]);
  return null;
}

export function BanksyOutboundLinks({ locale, surface }: { locale: "ko" | "en"; surface: "raffle_list" | "raffle_receipt" }) {
  const [visitId, setVisitId] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setVisitId(storedTouch()?.visitId ?? null);
    update(); window.addEventListener("byus-campaign-visit", update);
    return () => window.removeEventListener("byus-campaign-visit", update);
  }, []);
  function prepare(event: MouseEvent<HTMLAnchorElement>, destination: keyof typeof banksyDestinations) {
    // A fresh key per intentional click; the URL keeps it through network retries.
    event.currentTarget.href = campaignOutboundHref(destination, surface, storedTouch()?.visitId, crypto.randomUUID());
  }
  return <nav className={styles.links} aria-label={locale === "ko" ? "관련 전시와 굿즈" : "Exhibition and goods"}>
    <a href={campaignOutboundHref("exhibition", surface, visitId)} rel="nofollow noreferrer" onClick={event => prepare(event, "exhibition")} onAuxClick={event => prepare(event, "exhibition")}>{locale === "ko" ? "전시 자세히 보기" : "Exhibition details"}<span aria-hidden="true"> ↗</span></a>
    <a href={campaignOutboundHref("goods", surface, visitId)} rel="nofollow noreferrer" onClick={event => prepare(event, "goods")} onAuxClick={event => prepare(event, "goods")}>{locale === "ko" ? "굿즈 방문 예약" : "Book a goods shop visit"}<span aria-hidden="true"> ↗</span></a>
  </nav>;
}
