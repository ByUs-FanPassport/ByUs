"use client";

import Image from "next/image";
import type { AppLocale } from "@/i18n/locales";
import { additionalLocales } from "@/i18n/messages";
import { messages } from "@/i18n/catalogs/features__benefit__ui__raffle-result-reveal";
import { ArrowRight, Gift, Heart, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { bypassImageOptimization } from "@/components/fan-ui/public-image-policy";
import styles from "./raffle-result-reveal.module.css";

const copy = {
  ko: { ready: "나의 티켓에 담긴 결과는?", open: "내 결과 확인하기", waiting: "두구두구…", skip: "바로 결과 보기", replay: "다시 보기", help: "티켓을 열어 응모 결과를 확인해 보세요.", thanks: "함께해 줘서 고마워요", ticket: "당신을 위한 티켓", result: "내 응모 결과" },
  en: { ready: "What’s inside your ticket?", open: "Reveal my result", waiting: "Drumroll…", skip: "Show result now", replay: "Watch again", help: "Open your ticket to see your raffle result.", thanks: "Thank you for joining us", ticket: "A ticket for you", result: "My raffle result" },
  ...additionalLocales((locale) => ({
    ready: messages.ready[locale],
    open: messages.open[locale],
    waiting: messages.waiting[locale],
    skip: messages.skip[locale],
    replay: messages.replay[locale],
    help: messages.help[locale],
    thanks: messages.thanks[locale],
    ticket: messages.ticket[locale],
    result: messages.result[locale],
  })),
};
const seenEvent = "byus:raffle-result-seen";
function subscribeSeen(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(seenEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(seenEvent, callback);
  };
}

type Phase = "ready" | "anticipating" | "revealing" | "revealed";

export function RaffleResultReveal({ children, storageKey, outcome, title, imageUrl, headingId, announcement, locale }: {
  children: ReactNode; storageKey: string | null; outcome: "won" | "not_won";
  title: string; imageUrl?: string | null; headingId: string; announcement: string; locale: AppLocale;
}) {
  const t = copy[locale];
  const root = useRef<HTMLDivElement>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const seen = useSyncExternalStore(subscribeSeen, () => {
    try { return !!storageKey && localStorage.getItem(storageKey) === "1"; } catch { return false; }
  }, () => false);
  const show = !storageKey || phase === "revealing" || phase === "revealed" || (seen && phase === "ready");
  const visualPhase = show && phase === "ready" ? "revealed" : phase;

  useEffect(() => {
    if (!show) return;
    const markSeen = () => {
      if (document.hidden || !storageKey) return;
      try {
        if (localStorage.getItem(storageKey) !== "1") {
          localStorage.setItem(storageKey, "1");
          window.dispatchEvent(new Event(seenEvent));
        }
      } catch { /* Storage is optional; the result must stay available. */ }
    };
    markSeen();
    document.addEventListener("visibilitychange", markSeen);
    if (keyboard && !document.hidden) {
      root.current?.querySelector<HTMLElement>("[data-result-heading]")?.focus({ preventScroll: true });
    }
    return () => document.removeEventListener("visibilitychange", markSeen);
  }, [show, storageKey, keyboard]);

  useEffect(() => {
    if (phase !== "anticipating" && phase !== "revealing") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (phase === "anticipating" && keyboard) root.current?.querySelector<HTMLButtonElement>("[data-skip] button")?.focus({ preventScroll: true });
    let active = true;
    const animations: Animation[] = [];
    const settle = () => setPhase("revealed");
    const visibility = () => {
      if (document.hidden) setPhase(phase === "anticipating" ? "ready" : "revealed");
    };
    const animate = (selector: string, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const node = root.current?.querySelector<HTMLElement>(selector);
      if (node) animations.push(node.animate(frames, { fill: "both", ...options }));
    };
    // A stalled animation must never strand the result behind its ticket.
    const timer = window.setTimeout(settle, phase === "anticipating" ? 2200 : 1400);
    media.addEventListener("change", settle);
    document.addEventListener("visibilitychange", visibility);
    void (async () => {
      try {
        if (media.matches || !Element.prototype.animate) { settle(); return; }
        const ease = "cubic-bezier(.22,1,.36,1)";
        if (phase === "anticipating") {
          const beats = [[0, 0, 1], [.09, -.35, 1.006], [.18, .35, 1], [.25, 0, 1], [.34, -.6, 1.01], [.43, .6, 1], [.5, 0, 1], [.58, -.8, 1.016], [.66, .8, 1], [.72, 0, 1], [.78, -1.1, 1.025], [.84, 1.1, 1.025], [.9, 0, 1], [1, 0, 1]];
          animate("[data-ticket]", beats.map(([offset, rotation, scale]) => ({ offset, transform: `rotate(${rotation}deg) scale(${scale})` })), { duration: 1800, easing: "ease-in-out" });
          animate("[data-seal]", beats.map(([offset, , scale]) => ({ offset, transform: `scale(${1 + (scale - 1) * 6})` })), { duration: 1800, easing: "ease-in-out" });
        } else {
          animate("[data-seal]", [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.7) rotate(20deg)" }], { duration: 300, easing: ease });
          for (const [part, direction] of [["top", -1], ["bottom", 1]] as const) {
            animate(`[data-ticket-${part}]`, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 1, offset: .35 }, { opacity: 0, transform: `translateY(${direction * 110}%) rotate(${direction * 5}deg)` }], { duration: 680, delay: 130, easing: ease });
          }
          animate("[data-result-art]", [{ opacity: 0, transform: "scale(.94) translateY(12px)" }, { opacity: 1, transform: "scale(1)" }], { duration: 750, delay: 200, easing: ease });
          root.current?.querySelectorAll<HTMLElement>("[data-particle]").forEach((node, i) => {
            const angle = i / 22 * Math.PI * 2;
            const distance = 70 + (i % 5) * 23;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance - 50;
            animations.push(node.animate([
              { opacity: 0, transform: "translate(0,0) scale(.4)" },
              { opacity: .95, offset: .12 },
              { opacity: .8, offset: .6, transform: `translate(${x}px,${y}px) rotate(${i * 31}deg)` },
              { opacity: 0, transform: `translate(${x * 1.15}px,${y + 80}px) rotate(${i * 49}deg) scale(.8)` },
            ], { duration: 900, delay: 300 + (i % 3) * 30, easing: ease, fill: "both" }));
          });
        }
        await Promise.all(animations.map((animation) => animation.finished));
        if (active) setPhase(phase === "anticipating" ? "revealing" : "revealed");
      } catch {
        if (active) settle();
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timer);
      media.removeEventListener("change", settle);
      document.removeEventListener("visibilitychange", visibility);
      animations.forEach((animation) => animation.cancel());
    };
  }, [phase, keyboard]);

  const open = (detail: number) => {
    if (phase === "anticipating" || phase === "revealing") return;
    setKeyboard(detail === 0);
    setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "revealed" : "anticipating");
  };

  return <div ref={root} className={styles.stage} data-phase={visualPhase} data-outcome={outcome}>
    <div className={styles.media} aria-hidden="true">
      <div className={styles.art} data-result-art>
        {outcome === "won" ? imageUrl && failedImage !== imageUrl
          ? <Image src={imageUrl} alt="" fill sizes="(min-width: 768px) 430px, 100vw" unoptimized={bypassImageOptimization(imageUrl)} onError={() => setFailedImage(imageUrl)} />
          : <div className={styles.gift}><Gift />{title ? <span>{title}</span> : null}</div>
          : <div className={styles.thankYou}><span>WITH LOVE</span><Heart /><strong>{t.thanks}</strong><span>ByUs</span></div>}
      </div>
      <div className={styles.ticket} data-ticket>
        <div className={styles.ticketTop} data-ticket-top><span>BYUS RAFFLE</span><Sparkles /><strong>{t.ticket}</strong></div>
        <div className={styles.ticketBottom} data-ticket-bottom><span>{t.result}</span><span>ByUs</span><i /></div>
        <div className={styles.seal} data-seal><Sparkles /></div>
      </div>
      {outcome === "won" && phase === "revealing" ? <div className={styles.particles}>{Array.from({ length: 22 }, (_, i) => <i key={i} data-particle style={{ "--particle-color": ["#e7a5c1", "#282525", "#f3e6cd"][i % 3] } as CSSProperties} />)}</div> : null}
    </div>
    <div className={styles.content}>
      {show ? <>{children}<FanAction className={styles.replay} variant="text" leadingIcon={<RotateCcw />} onClick={(event) => open(event.detail)} disabled={phase === "revealing"}>{t.replay}</FanAction></>
        : <div className={styles.invitation}>
          <span className={styles.eyebrow}>{t.result}</span>
          <h2 id={headingId}>{t.ready}</h2>
          <p>{t.help}</p>
          <FanAction variant="primary" fullWidth onClick={(event) => open(event.detail)} disabled={phase === "anticipating"} ariaBusy={phase === "anticipating"} trailingIcon={<ArrowRight />}>{phase === "anticipating" ? t.waiting : t.open}</FanAction>
          <div data-skip><FanAction variant="text" fullWidth onClick={(event) => { setKeyboard(event.detail === 0); setPhase("revealed"); }}>{t.skip}</FanAction></div>
          {title ? <h3>{title}</h3> : null}
        </div>}
      <span className={styles.srOnly} role="status">{phase === "anticipating" ? t.waiting : show && phase !== "ready" && !keyboard ? announcement : ""}</span>
    </div>
  </div>;
}
