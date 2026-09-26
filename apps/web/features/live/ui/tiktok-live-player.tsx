"use client";

import { useEffect, useId, useRef, useState } from "react";
import type Mpegts from "mpegts.js";
import { ArrowUpRight, CircleAlert, LoaderCircle, Maximize, Minimize, Radio, RotateCcw, Volume2, X } from "lucide-react";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { OBSERVED_LIVE_FUTURE_SKEW_MS, type ObservedLiveCard } from "../domain/observed-live";
import { tiktokPlaybackResponseSchema } from "../domain/tiktok-playback";
import styles from "./tiktok-live-player.module.css";

const copy = {
  ko: { close: "닫기", loading: "LIVE를 불러오는 중이에요.", ended: "LIVE가 종료됐어요.", error: "LIVE를 재생할 수 없어요. 다시 시도하거나 TikTok에서 시청해 주세요.", unsupported: "이 브라우저에서는 LIVE를 재생할 수 없어요. TikTok에서 시청해 주세요.", retry: "다시 시도", sound: "소리 켜고 재생", original: "TikTok에서 시청" },
  en: { close: "Close", loading: "Loading LIVE…", ended: "This LIVE has ended.", error: "Unable to play this LIVE. Try again or watch on TikTok.", unsupported: "This browser cannot play this LIVE. Watch on TikTok.", retry: "Try again", sound: "Play with sound", original: "Watch on TikTok" },
  ja: { close: "閉じる", loading: "LIVEを読み込み中…", ended: "LIVEは終了しました。", error: "LIVEを再生できません。再試行するか、TikTokでご覧ください。", unsupported: "このブラウザではLIVEを再生できません。TikTokでご覧ください。", retry: "再試行", sound: "音声付きで再生", original: "TikTokで見る" },
  "zh-Hans": { close: "关闭", loading: "正在加载 LIVE…", ended: "LIVE 已结束。", error: "无法播放 LIVE。请重试或前往 TikTok 观看。", unsupported: "此浏览器无法播放 LIVE。请前往 TikTok 观看。", retry: "重试", sound: "开启声音播放", original: "在 TikTok 观看" },
  "zh-Hant": { close: "關閉", loading: "正在載入 LIVE…", ended: "LIVE 已結束。", error: "無法播放 LIVE。請重試或前往 TikTok 觀看。", unsupported: "此瀏覽器無法播放 LIVE。請前往 TikTok 觀看。", retry: "重試", sound: "開啟聲音播放", original: "在 TikTok 觀看" },
  es: { close: "Cerrar", loading: "Cargando LIVE…", ended: "Este LIVE ha terminado.", error: "No se puede reproducir este LIVE. Inténtalo de nuevo o míralo en TikTok.", unsupported: "Este navegador no puede reproducir este LIVE. Míralo en TikTok.", retry: "Reintentar", sound: "Reproducir con sonido", original: "Ver en TikTok" },
  id: { close: "Tutup", loading: "Memuat LIVE…", ended: "LIVE ini telah berakhir.", error: "LIVE tidak dapat diputar. Coba lagi atau tonton di TikTok.", unsupported: "Browser ini tidak dapat memutar LIVE. Tonton di TikTok.", retry: "Coba lagi", sound: "Putar dengan suara", original: "Tonton di TikTok" },
  vi: { close: "Đóng", loading: "Đang tải LIVE…", ended: "LIVE đã kết thúc.", error: "Không thể phát LIVE. Hãy thử lại hoặc xem trên TikTok.", unsupported: "Trình duyệt này không thể phát LIVE. Hãy xem trên TikTok.", retry: "Thử lại", sound: "Phát có âm thanh", original: "Xem trên TikTok" },
  th: { close: "ปิด", loading: "กำลังโหลด LIVE…", ended: "LIVE นี้สิ้นสุดแล้ว", error: "เล่น LIVE ไม่ได้ โปรดลองอีกครั้งหรือรับชมบน TikTok", unsupported: "เบราว์เซอร์นี้เล่น LIVE ไม่ได้ โปรดรับชมบน TikTok", retry: "ลองอีกครั้ง", sound: "เล่นพร้อมเสียง", original: "รับชมบน TikTok" },
  pt: { close: "Fechar", loading: "A carregar o LIVE…", ended: "Este LIVE terminou.", error: "Não foi possível reproduzir este LIVE. Tente novamente ou veja no TikTok.", unsupported: "Este navegador não consegue reproduzir este LIVE. Veja no TikTok.", retry: "Tentar novamente", sound: "Reproduzir com som", original: "Assistir no TikTok" },
  fr: { close: "Fermer", loading: "Chargement du LIVE…", ended: "Ce LIVE est terminé.", error: "Impossible de lire ce LIVE. Réessayez ou regardez-le sur TikTok.", unsupported: "Ce navigateur ne peut pas lire ce LIVE. Regardez-le sur TikTok.", retry: "Réessayer", sound: "Lire avec le son", original: "Regarder sur TikTok" },
} satisfies Record<AppLocale, Record<string, string>>;

const framingCopy = {
  ko: ["화면 채우기", "전체 영상 보기"], en: ["Fill screen", "Show full video"],
  ja: ["画面いっぱいに表示", "映像全体を表示"], "zh-Hans": ["填满画面", "显示完整画面"], "zh-Hant": ["填滿畫面", "顯示完整畫面"],
  es: ["Llenar pantalla", "Ver vídeo completo"], id: ["Penuhi layar", "Tampilkan seluruh video"],
  vi: ["Lấp đầy màn hình", "Hiển thị toàn bộ video"], th: ["เติมเต็มหน้าจอ", "แสดงวิดีโอทั้งหมด"],
  pt: ["Preencher ecrã", "Mostrar vídeo completo"], fr: ["Remplir l’écran", "Afficher toute la vidéo"],
} satisfies Record<AppLocale, [string, string]>;

type PlayerStatus = "loading" | "playing" | "paused" | "ended" | "error" | "unsupported";

function LiveVideo({ item, locale, status, setStatus }: { item: ObservedLiveCard; locale: AppLocale; status: PlayerStatus; setStatus: (status: PlayerStatus) => void }) {
  const slug = item.celebritySlug;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(true);
  const [fill, setFill] = useState(false);
  const t = copy[locale];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false, pending = false, recovered = false, queuedRecovery = false;
    let player: Mpegts.Player | undefined;
    let activeRoom = "", activeExpiry = 0;
    let controller: AbortController | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let startup: ReturnType<typeof setTimeout> | undefined;
    let freshness: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const destroy = () => { const old = player; player = undefined; old?.destroy(); };
    const stop = (next: "ended" | "error" | "unsupported") => {
      stopped = true;
      clearTimeout(poll); clearTimeout(startup); clearTimeout(freshness); clearTimeout(expiry);
      controller?.abort(); destroy(); setStatus(next);
    };
    setStatus("loading");

    async function start() {
      const mpegts = (await import("mpegts.js")).default;
      if (stopped) return;
      if (!mpegts.getFeatureList().mseLivePlayback) { stop("unsupported"); return; }
      // The library otherwise logs upstream signed stream URLs on playback errors.
      mpegts.LoggingControl.enableAll = false;
      const recover = () => {
        if (stopped) return;
        if (recovered) { stop("error"); return; }
        recovered = true; clearTimeout(startup); destroy(); setStatus("loading");
        if (pending) queuedRecovery = true;
        else void refresh();
      };
      async function refresh() {
        if (stopped || pending) return;
        clearTimeout(poll);
        pending = true;
        let nextCheck = 30_000;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 8_000);
        try {
          const response = await fetch(`/api/public/live-now/${encodeURIComponent(slug)}/playback?locale=${toContentLocale(locale)}`, {
            cache: "no-store", signal: controller.signal,
          });
          if (stopped) return;
          if (response.status === 410) { stop("ended"); return; }
          if (response.status === 403 || response.status === 404) { stop("error"); return; }
          if (!response.ok) throw new Error("LIVE unavailable");
          const source = tiktokPlaybackResponseSchema.parse(await response.json());
          if (stopped) return;
          const now = Date.now(), sourceExpiry = Date.parse(source.expiresAt), observedAt = Date.parse(source.observedAt);
          if (sourceExpiry <= now + 5_000 || observedAt > now + OBSERVED_LIVE_FUTURE_SKEW_MS || now - observedAt > 60_000) throw new Error("Stale LIVE");
          clearTimeout(freshness);
          freshness = setTimeout(() => stop("error"), 60_000);
          if (player && (activeRoom !== source.roomId || activeExpiry - now < 45_000)) destroy();
          if (!player) {
            activeRoom = source.roomId; activeExpiry = sourceExpiry;
            clearTimeout(expiry);
            expiry = setTimeout(recover, Math.max(0, Math.min(2_147_483_647, activeExpiry - now - 5_000)));
            player = mpegts.createPlayer({ type: "flv", isLive: true, url: source.url }, {
              enableStashBuffer: false, liveBufferLatencyChasing: true,
            });
            player.on(mpegts.Events.ERROR, recover);
            player.attachMediaElement(video!); player.load();
            clearTimeout(startup); startup = setTimeout(recover, 12_000);
            void player.play()?.catch(() => { if (!stopped) { clearTimeout(startup); setStatus("paused"); } });
          }
        } catch {
          if (!stopped && !player) stop("error");
          nextCheck = 10_000;
          // An ongoing stream gets at most 60 seconds without a fresh access check.
        } finally {
          clearTimeout(timeout); pending = false;
          if (queuedRecovery && !stopped) { queuedRecovery = false; void refresh(); }
          else if (!stopped) poll = setTimeout(() => void refresh(), nextCheck);
        }
      }
      const playing = () => { clearTimeout(startup); if (!stopped) setStatus("playing"); };
      const waiting = () => { if (!stopped) { clearTimeout(startup); startup = setTimeout(recover, 12_000); } };
      video!.addEventListener("playing", playing);
      video!.addEventListener("waiting", waiting);
      video!.addEventListener("ended", recover);
      removeListeners = () => {
        video!.removeEventListener("playing", playing); video!.removeEventListener("waiting", waiting); video!.removeEventListener("ended", recover);
      };
      await refresh();
    }
    let removeListeners = () => {};
    void start().catch(() => { if (!stopped) stop("error"); });
    return () => {
      stopped = true; clearTimeout(poll); clearTimeout(startup); clearTimeout(freshness); clearTimeout(expiry);
      controller?.abort(); removeListeners(); destroy();
    };
  }, [slug, locale, attempt, setStatus]);

  const active = status === "playing" || status === "paused";
  const externalFallback = status === "ended" || status === "error" || status === "unsupported";
  return <div className={styles.player} data-state={status}>
    <div className={styles.stage} data-state={status}>
      <video ref={videoRef} className={styles.video} controls playsInline autoPlay muted={muted} disableRemotePlayback
        data-fill={fill} tabIndex={0} aria-label="TikTok LIVE" onVolumeChange={() => setMuted(videoRef.current?.muted ?? true)} />
      {active ? <span className={styles.liveBadge}><span />LIVE</span> : null}
      <div className={styles.status} hidden={active}>
        {status === "loading" ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : status === "ended" ? <Radio aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
        <p role="status">{status === "loading" ? t.loading : status === "ended" ? t.ended : status === "error" ? t.error : status === "unsupported" ? t.unsupported : ""}</p>
        {externalFallback ? <div className={styles.fallbackActions}>
          <a className={styles.fallbackOriginal} href={item.watchUrl} target="_blank" rel="noopener noreferrer">{t.original}<ArrowUpRight aria-hidden="true" /></a>
          {status === "error" ? <button type="button" className={styles.retry} onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}><RotateCcw aria-hidden="true" />{t.retry}</button> : null}
        </div> : null}
      </div>
      {(status === "playing" && muted) || status === "paused" ? <button type="button" className={styles.sound} onClick={() => {
        setMuted(false); const video = videoRef.current; if (video) { video.muted = false; void video.play().catch(() => setStatus("paused")); }
      }}><Volume2 aria-hidden="true" />{t.sound}</button> : null}
    </div>
    {externalFallback ? null : <footer className={styles.footer}>
      <p className={styles.title}>{item.title}</p>
      <div className={styles.actions}>
        <a className={styles.original} href={item.watchUrl} target="_blank" rel="noopener noreferrer">{t.original}<ArrowUpRight aria-hidden="true" /></a>
        {active ? <button type="button" className={styles.framing} onClick={() => setFill((value) => !value)}
          aria-label={framingCopy[locale][fill ? 1 : 0]} title={framingCopy[locale][fill ? 1 : 0]} aria-pressed={fill}>
          {fill ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
        </button> : null}
      </div>
    </footer>}
  </div>;
}

export function TikTokLivePlayer({ item, locale, onClose }: { item: ObservedLiveCard; locale: AppLocale; onClose: () => void }) {
  const headingId = useId();
  const t = copy[locale];
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const compact = status === "ended" || status === "error" || status === "unsupported";
  return <AccessibleOverlay open onClose={onClose} labelledBy={headingId} backdropClassName={styles.backdrop} contentClassName={`${styles.dialog} ${compact ? styles.compactDialog : ""}`} contentAs="section">
    <header className={styles.header}>
      <div className={styles.identity}>
        <img className={styles.avatar} src={item.fallbackThumbnailUrl ?? item.thumbnailUrl} alt="" referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.display = "none"; }} />
        <div><h2 id={headingId}>{item.creatorName}<span className={styles.srOnly}> LIVE</span></h2><p>TikTok <span aria-hidden="true">·</span> @{item.handle}</p></div>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label={t.close}><X aria-hidden="true" /></button>
    </header>
    <LiveVideo item={item} locale={locale} status={status} setStatus={setStatus} />
  </AccessibleOverlay>;
}
