"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import type { ContentAsset } from "@/features/fan-posts/domain/content";
import type { AppLocale } from "@/i18n/locales";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import styles from "./content.module.css";

export function ContentAssetImage({ asset, locale, alt, adminPreview = false }: { asset: ContentAsset; locale: AppLocale; alt: string; adminPreview?: boolean }) {
  const auth = usePrivy(), session = useByUsSession(), copy = contentCopy(locale);
  const { ready, authenticated, getAccessToken } = auth;
  const [retry, setRetry] = useState(0), [snapshot, setSnapshot] = useState<{ key: string; url?: string; failed?: boolean }>();
  const key = `${asset.id}:${adminPreview}:${auth.ready}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}:${retry}`;
  useEffect(() => {
    if (!ready || !session.ready) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    void (async () => {
      try {
        const token = authenticated ? await getAccessToken() : null;
        controller.signal.throwIfAborted();
        if (authenticated && !token) throw new Error();
        const response = await fetch(`/api/content-assets/${asset.id}${adminPreview ? "?admin=1" : ""}`, { cache: "no-store", signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (!response.ok) throw new Error();
        const blob = await response.blob(); controller.signal.throwIfAborted();
        objectUrl = URL.createObjectURL(blob); setSnapshot({ key, url: objectUrl });
      } catch { if (!controller.signal.aborted) setSnapshot({ key, failed: true }); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, asset.id, adminPreview, ready, authenticated, getAccessToken, session.ready]);
  const current = snapshot?.key === key ? snapshot : null;
  return current?.url ? <img className={styles.photo} src={current.url} alt={alt} width={asset.width} height={asset.height} />
    : <span className={styles.status} role="status">{current?.failed ? copy.photoFailed : copy.loading}{current?.failed && <button type="button" className={styles.button} onClick={() => setRetry(value => value + 1)}>{copy.retry}</button>}</span>;
}
