"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, Flag, X } from "lucide-react";
import { z } from "zod";
import { Dialog } from "@/components/ui/overlay/accessible-overlay";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { useAppLocale } from "@/components/locale-provider";
import { useByUsSession } from "@/components/byus-session-provider";
import { mySummarySchema } from "@/features/my/domain/my-summary";
import { liveEventResponseSchema } from "@/features/live/domain/live-event";
import { nextFanAction, supportsFanGuide, type NextFanAction } from "../domain/next-fan-action";
import { onboardingStateSchema } from "../domain/onboarding-state";
import styles from "./fan-next-action-guide.module.css";

const parseSummary = (body: unknown) => z.object({ summary: mySummarySchema }).parse(body).summary;
const parseCatalog = (body: unknown) => z.object({ catalog: z.object({ upcoming: z.array(liveEventResponseSchema) }) }).parse(body).catalog.upcoming;
const parseOnboarding = (body: unknown) => z.object({ onboarding: onboardingStateSchema }).parse(body).onboarding;
const dismissedInMemory = new Set<string>();
const dismissalKey = (ownerId: string) => `byus:fan-guide:dismissed:${ownerId}`;
function isDismissed(ownerId: string) {
  try { return dismissedInMemory.has(ownerId) || localStorage.getItem(dismissalKey(ownerId)) === "true"; }
  catch { return dismissedInMemory.has(ownerId); }
}
function rememberDismissal(ownerId: string) {
  dismissedInMemory.add(ownerId);
  try { localStorage.setItem(dismissalKey(ownerId), "true"); } catch { /* Server preference is authoritative. */ }
}
const seenInMemory = new Set<string>();
const storageKey = (ownerId: string) => `byus:fan-guide:v2:${ownerId}`;
function hasSeen(key: string) {
  try { return seenInMemory.has(key) || sessionStorage.getItem(key) === "seen"; }
  catch { return seenInMemory.has(key); }
}
function markSeen(key: string) {
  seenInMemory.add(key);
  try { sessionStorage.setItem(key, "seen"); } catch { /* The guide remains usable without storage. */ }
}

export function FanNextActionDialog({ action, locale, onClose, onContinue }: {
  action: NextFanAction; locale: "ko" | "en"; onClose(): void; onContinue(): void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ko = locale === "ko";
  const current = ["profile", "verify", "reserve"].indexOf(action.step);
  const steps = ko ? ["프로필", "팬 인증", "LIVE 예약"] : ["Profile", "Fan verification", "LIVE reservation"];
  const selecting = action.step === "verify" && action.href.startsWith("/celebrities");
  const title = action.step === "profile" ? (ko ? "어떤 이름으로 활동할까요?" : "What should we call you?")
    : action.step === "verify" ? (ko ? "최애의 팬임을 인증해 보세요" : "Verify your fandom")
    : (ko ? "다음 만남을 예약해 보세요" : "Reserve your next LIVE");
  const description = action.step === "profile" ? (ko ? "닉네임을 정하면 팬 인증과 활동 기록에 사용할 수 있어요." : "Choose a display name for your fan verification and activity history.")
    : action.step === "verify" ? (ko ? "퀴즈를 통과하면 최애의 Fan Passport가 발급돼요." : "Pass the quiz to get a Fan Passport for this creator.")
    : (ko ? "팬 인증을 마쳤어요. 예약 가능한 LIVE에서 다음 만남을 준비하세요." : "You’re verified. Continue to an available LIVE to make your reservation.");
  const label = action.step === "profile" ? (ko ? "닉네임 정하기" : "Set display name")
    : action.step === "verify" ? (selecting ? (ko ? "최애 선택하기" : "Choose a favorite") : (ko ? "퀴즈 풀고 팬 인증하기" : "Take the fan quiz"))
    : (ko ? "LIVE 예약하러 가기" : "Continue to LIVE reservation");
  return <Dialog open onClose={onClose} labelledBy={titleId} describedBy={descriptionId}
    initialFocusRef={headingRef} backdropClassName={styles.backdrop} contentClassName={styles.dialog}>
    <div className={styles.top}><span>{ko ? "팬 활동 시작하기" : "Start your fan journey"}</span>
      <button type="button" className={styles.close} onClick={onClose} aria-label={ko ? "안내 닫기" : "Close guide"}><X aria-hidden="true" /></button></div>
    <ol className={styles.steps} aria-label={ko ? "팬 활동 단계" : "Fan journey steps"}>{steps.map((step, index) =>
      <li key={step} aria-current={index === current ? "step" : undefined} data-complete={index < current || undefined}>
        <span className={styles.number}>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><span>{step}</span>
      </li>)}</ol>
    <h2 ref={headingRef} tabIndex={-1} id={titleId}>{title}</h2>
    <p className={styles.description} id={descriptionId}>{description}</p>
    {action.liveTitle ? <div className={styles.target}><span>{action.targetName}</span><strong>{action.liveTitle}</strong></div> : null}
    <div className={styles.actions}><FanAction href={action.href} variant="primary" fullWidth onClick={onContinue} trailingIcon={<ArrowRight />}>{label}</FanAction>
      <FanAction variant="text" fullWidth onClick={onClose}>{ko ? "나중에 할게요" : "Maybe later"}</FanAction></div>
  </Dialog>;
}

function GuidePrompt({ action, ownerId, locale, dismissed, onDismiss }: { action: NextFanAction; ownerId: string; locale: "ko" | "en"; dismissed: boolean; onDismiss(): void }) {
  const key = storageKey(ownerId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (dismissed || isDismissed(ownerId) || hasSeen(key)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tryOpen = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden" || isDismissed(ownerId) || hasSeen(key)) return;
        if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-overlay-host], dialog[open]')) { markSeen(key); return; }
        if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
        markSeen(key);
        setOpen(true);
      }, 600);
    };
    // Let an existing dialog or in-progress input finish before offering guidance.
    const observer = new MutationObserver(tryOpen);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusout", tryOpen);
    document.addEventListener("visibilitychange", tryOpen);
    tryOpen();
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("focusout", tryOpen); document.removeEventListener("visibilitychange", tryOpen); };
  }, [key, dismissed, ownerId]);
  const close = () => { markSeen(key); setOpen(false); };
  const dismiss = () => { rememberDismissal(ownerId); close(); onDismiss(); };
  return <>
    <button className={styles.launcher} type="button" onClick={() => { markSeen(key); setOpen(true); }} aria-haspopup="dialog">
      <Flag aria-hidden="true" />{locale === "ko" ? "다음 단계" : "Next step"}<ArrowRight aria-hidden="true" />
    </button>
    {open ? <FanNextActionDialog action={action} locale={locale} onClose={dismiss} onContinue={close} /> : null}
  </>;
}

function OwnedGuide({ pathname, locale }: { pathname: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  const session = useByUsSession();
  const { getAccessToken } = auth;
  const ownerId = session.ownerId ?? auth.user?.id;
  const identity = `${ownerId}:${session.generation}:${session.ready}:${auth.ready}:${auth.authenticated}:${auth.user?.id}`;
  const currentIdentity = useRef(identity);
  useLayoutEffect(() => { currentIdentity.current = identity; return () => { currentIdentity.current = ""; }; }, [identity]);
  const enabled = session.ready && auth.ready && auth.authenticated && Boolean(ownerId) && (!session.ownerId || session.ownerId === auth.user?.id);
  const onboarding = useOwnedFanResource(enabled ? "/api/me/onboarding" : null, parseOnboarding, auth);
  const { retry: refreshOnboarding } = onboarding;
  const summary = useOwnedFanResource(enabled ? `/api/me/summary?locale=${locale}` : null, parseSummary, auth);
  const needsCatalog = onboarding.state.status === "ready" && !onboarding.state.data.completed.reserve && summary.state.status === "ready" && Boolean(summary.state.data.profile.nickname)
    && summary.state.data.creators.some((creator) => creator.passport);
  const catalog = useOwnedFanResource(enabled && needsCatalog ? `/api/live-events?locale=${locale}` : null, parseCatalog, auth);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!needsCatalog) return;
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, [needsCatalog]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => refreshOnboarding();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); };
  }, [enabled, refreshOnboarding]);
  useEffect(() => {
    if (!enabled || !ownerId || onboarding.state.status !== "ready" || onboarding.state.data.dismissed || !isDismissed(ownerId)) return;
    let active = true;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!active || !token || currentIdentity.current !== identity) return;
        await fetch("/api/me/onboarding", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", keepalive: true });
      } catch { /* Retain the local dismissal and retry on the next account read. */ }
    })();
    return () => { active = false; };
  }, [enabled, ownerId, identity, getAccessToken, onboarding.state]);
  if (!enabled || summary.state.status !== "ready" || summary.refreshFailed || onboarding.state.status !== "ready" || onboarding.refreshFailed) return null;
  const action = nextFanAction({ summary: summary.state.data, completed: onboarding.state.data.completed, pathname, locale, now,
    lives: catalog.state.status === "ready" && !catalog.refreshFailed ? catalog.state.data : undefined });
  if (!action) return null;
  const dismiss = () => {
    // Close immediately; keep the suppression for this owner even if persistence fails.
    const owner = ownerId!;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token || currentIdentity.current !== identity) return;
        const response = await fetch("/api/me/onboarding", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", keepalive: true });
        if (!response.ok) return;
        parseOnboarding(await response.json());
        rememberDismissal(owner);
      } catch { /* A later page load reads the account preference again. */ }
    })();
  };
  return <GuidePrompt dismissed={onboarding.state.data.dismissed} onDismiss={dismiss} key={`${ownerId}:${session.generation}:${action.step}`} action={action} ownerId={ownerId!} locale={locale} />;
}

export function FanNextActionGuide() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { locale: appLocale } = useAppLocale();
  const locale = search?.get("locale") === "en" ? "en" : search?.get("locale") === "ko" ? "ko" : appLocale;
  if (!pathname || !supportsFanGuide(pathname, search?.toString() ?? "")) return null;
  return <OwnedGuide key={pathname} pathname={pathname} locale={locale} />;
}
