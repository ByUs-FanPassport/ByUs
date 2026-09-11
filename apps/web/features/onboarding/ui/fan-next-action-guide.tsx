"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Flag, X } from "lucide-react";
import { z } from "zod";
import { Dialog } from "@/components/ui/overlay/accessible-overlay";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { useAppLocale } from "@/components/locale-provider";
import { mySummarySchema } from "@/features/my/domain/my-summary";
import { liveEventResponseSchema } from "@/features/live/domain/live-event";
import { nextFanAction, supportsFanGuide, type NextFanAction } from "../domain/next-fan-action";
import styles from "./fan-next-action-guide.module.css";

const parseSummary = (body: unknown) => z.object({ summary: mySummarySchema }).parse(body).summary;
const parseCatalog = (body: unknown) => z.object({ catalog: z.object({ upcoming: z.array(liveEventResponseSchema) }) }).parse(body).catalog.upcoming;
const seenInMemory = new Set<string>();
const storageKey = (ownerId: string, step: NextFanAction["step"]) => `byus:fan-guide:v1:${ownerId}:${step}`;
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
    : action.step === "verify" ? (ko ? "퀴즈를 통과하면 최애의 Fan Passport가 발급돼요." : "Pass the quiz to get your favorite’s Fan Passport.")
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

function GuidePrompt({ action, ownerId, locale }: { action: NextFanAction; ownerId: string; locale: "ko" | "en" }) {
  const key = storageKey(ownerId, action.step);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hasSeen(key)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tryOpen = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden" || hasSeen(key)) return;
        if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-overlay-host]')) return;
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
  }, [key]);
  const close = () => { markSeen(key); setOpen(false); };
  return <>
    <button className={styles.launcher} type="button" onClick={() => { markSeen(key); setOpen(true); }} aria-haspopup="dialog">
      <Flag aria-hidden="true" />{locale === "ko" ? "다음 단계" : "Next step"}<ArrowRight aria-hidden="true" />
    </button>
    {open ? <FanNextActionDialog action={action} locale={locale} onClose={close} onContinue={close} /> : null}
  </>;
}

function OwnedGuide({ pathname, locale }: { pathname: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  const enabled = auth.ready && auth.authenticated && Boolean(auth.user?.id);
  const summary = useOwnedFanResource(enabled ? `/api/me/summary?locale=${locale}` : null, parseSummary, auth);
  const needsCatalog = summary.state.status === "ready" && Boolean(summary.state.data.profile.nickname)
    && summary.state.data.creators.some((creator) => creator.passport);
  const catalog = useOwnedFanResource(enabled && needsCatalog ? `/api/live-events?locale=${locale}` : null, parseCatalog, auth);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!needsCatalog) return;
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, [needsCatalog]);
  if (!enabled || summary.state.status !== "ready" || summary.refreshFailed) return null;
  const action = nextFanAction({ summary: summary.state.data, pathname, locale, now,
    lives: catalog.state.status === "ready" && !catalog.refreshFailed ? catalog.state.data : undefined });
  if (!action) return null;
  return <GuidePrompt key={`${auth.user!.id}:${action.step}`} action={action} ownerId={auth.user!.id} locale={locale} />;
}

export function FanNextActionGuide() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { locale: appLocale } = useAppLocale();
  const locale = search?.get("locale") === "en" ? "en" : search?.get("locale") === "ko" ? "ko" : appLocale;
  if (!pathname || !supportsFanGuide(pathname, search?.toString() ?? "")) return null;
  return <OwnedGuide key={pathname} pathname={pathname} locale={locale} />;
}
