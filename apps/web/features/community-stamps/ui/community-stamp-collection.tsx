"use client";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Copy, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { notifyFanActivityUpdated } from "@/components/fan-ui/fan-activity-updates";
import { AVAILABLE_COMMUNITY_STAMPS, COMMUNITY_STAMPS, communityAwardResultSchema, communityInviteSchema, type CommunityStamp, type CommunityStampKind } from "../domain/community-stamps";
import { CommunityStampArtwork } from "./community-stamp-artwork";
import { SharePassport } from "./share-passport";
import { communityStampAction, useCommunityStamps } from "./use-community-stamps";
import styles from "./community-stamps.module.css";

type Locale = "ko" | "en";
type Resource = ReturnType<typeof useCommunityStamps>;
function errorCopy(error: unknown, locale: Locale) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, [string, string]> = {
    COMMUNITY_STAMP_SELF_INVITE: ["내 코드는 입력할 수 없어요.", "You can’t use your own code."],
    COMMUNITY_STAMP_ALREADY_REDEEMED: ["이미 친구 코드를 인증했어요.", "You’ve already used a friend’s code."],
    COMMUNITY_STAMP_NOT_FOUND: ["코드 또는 최애 정보를 확인해 주세요.", "Check the code or creator and try again."],
    COMMUNITY_STAMP_WALLET_NOT_READY: ["지갑을 준비하고 있어요. 잠시 후 다시 시도해 주세요.", "Your wallet is being prepared. Please try again shortly."],
    AUTHENTICATION_REQUIRED: ["다시 로그인해 주세요.", "Please sign in again."],
  };
  return (messages[code] ?? ["완료하지 못했어요. 다시 시도해 주세요.", "Couldn’t complete this. Please try again."])[locale === "ko" ? 0 : 1];
}
export function CommunityStampCollection({ locale, creator, resource }: { locale: Locale; creator?: string; resource: Resource }) {
  const auth = usePrivy();
  if (!auth.ready || !auth.authenticated) return null;
  return <OwnerCollection key={`${auth.user?.id}:${creator ?? "all"}`} locale={locale} creator={creator} resource={resource} />;
}
function OwnerCollection({ locale, creator, resource }: { locale: Locale; creator?: string; resource: Resource }) {
  const auth = usePrivy(); const ko = locale === "ko";
  const [selected, setSelected] = useState<CommunityStamp | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<{ code: string; redeemed: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const stamps = resource.state.status === "ready" ? resource.state.data.stamps : [];
  const visible = stamps.filter(stamp => !creator || stamp.celebritySlug === creator);
  const kinds = AVAILABLE_COMMUNITY_STAMPS.filter(kind => !creator || COMMUNITY_STAMPS[kind].scope === "creator");
  const earned = (kind: CommunityStampKind) => visible.find(stamp => stamp.kind === kind);
  async function run(action: "welcome" | "invite-code" | "redeem-invite") {
    if (busy) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (action === "invite-code") {
        const result = await communityStampAction(auth.getAccessToken, action, {}, value => communityInviteSchema.parse(value));
        if (alive.current) setInvite(result);
      } else {
        const result = await communityStampAction(auth.getAccessToken, action, action === "redeem-invite" ? { code } : {}, value => communityAwardResultSchema.parse(value));
        if (alive.current) {
          setMessage(result.awarded ? (ko ? "새 스탬프가 기록됐어요." : "Your new Stamp has been recorded.") : (ko ? "이미 받은 스탬프예요." : "You’ve already earned this Stamp."));
          if (action === "redeem-invite") setInvite(current => current ? { ...current, redeemed: true } : current);
          resource.retry(); notifyFanActivityUpdated(auth.user?.id);
        }
      }
    } catch (error) { if (alive.current) { setMessage(errorCopy(error, locale)); setFailed(true); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(invite!.code); if (alive.current) { setFailed(false); setMessage(ko ? "초대코드를 복사했어요." : "Invite code copied."); } }
    catch { if (alive.current) { setFailed(true); setMessage(ko ? "코드를 선택해서 복사해 주세요." : "Select the code to copy it."); } }
  }
  return <section className={styles.section} id="community-stamps" aria-labelledby="community-stamps-title">
    <div className={styles.heading}><div><h2 id="community-stamps-title">{ko ? "스탬프 모으기" : "Collect Stamps"}</h2><p>{creator ? (ko ? "최애와 함께한 일상을 차곡차곡 모아요." : "Collect everyday moments with your favorite.") : (ko ? "첫 인사부터 매일의 출석까지, 나만의 팬 기록." : "From your first hello to everyday check-ins." )}</p></div>{resource.state.status === "ready" && <span className={styles.count}>{ko ? `${visible.length}개 수집` : `${visible.length} collected`}</span>}</div>
    {resource.state.status === "loading" ? <p className={styles.status} role="status">{ko ? "스탬프를 불러오고 있어요." : "Loading your Stamps."}</p> : resource.state.status === "error" ? <p className={styles.status} role="alert">{ko ? "스탬프를 불러오지 못했어요." : "Couldn’t load your Stamps."} <button className={styles.action} onClick={resource.retry}><RotateCcw aria-hidden="true"/>{ko ? "다시 시도" : "Try again"}</button></p> : <>
      {resource.refreshFailed && <p role="alert" className={styles.status}>{ko ? "최신 기록을 확인하지 못했어요." : "Couldn’t refresh your Stamps."} <button className={styles.action} onClick={resource.retry}>{ko ? "다시 시도" : "Retry"}</button></p>}
      <ul className={styles.grid}>{kinds.map(kind => {
        const stamp = earned(kind); const info = COMMUNITY_STAMPS[kind];
        const href = creator ? `/c/${creator}?locale=${locale}${kind === "daily_checkin" ? "#daily-checkin" : "#cheers"}` : kind === "share" ? `/passports?locale=${locale}` : `/celebrities?locale=${locale}`;
        return <li className={styles.card} data-earned={!!stamp} key={kind}>
          <CommunityStampArtwork kind={kind} locale={locale} className={styles.art} decorative/>
          <h3>{info[locale]}</h3>{stamp && <span className={styles.state}><Check aria-hidden="true"/>{ko ? "획득" : "Earned"}</span>}
          <p>{ko ? info.koHelp : info.enHelp}</p>
          {stamp ? <button className={styles.action} onClick={() => setSelected(stamp)}>{ko ? "스탬프 보기" : "View Stamp"}</button> : kind === "welcome" ? <button className={styles.action} disabled={busy} onClick={() => void run("welcome")}>{ko ? "가입 스탬프 받기" : "Get welcome Stamp"}</button> : kind === "invite" ? <button className={styles.action} disabled={busy} onClick={() => { setInviteOpen(true); void run("invite-code"); }}>{ko ? "친구 초대하기" : "Invite a friend"}</button> : kind === "share" && creator ? <SharePassport creator={{ slug: creator, name: creator }} locale={locale}/> : <Link className={styles.action} href={href as Route}>{kind === "daily_checkin" ? (ko ? "출석하러 가기" : "Check in") : kind === "share" ? (ko ? "패스포트 고르기" : "Choose a Passport") : (ko ? "댓글 남기기" : "Leave a comment")}</Link>}
        </li>;
      })}</ul>
      {!creator && earned("invite") && !inviteOpen && <button className={styles.action} onClick={() => { setInviteOpen(true); void run("invite-code"); }}>{ko ? "내 초대코드" : "My invite code"}</button>}
      {inviteOpen && !creator && <div className={styles.invite}>
        <div><h3>{ko ? "친구와 함께 받는 스탬프" : "A Stamp for both of you"}</h3><p className={styles.help}>{ko ? "내 코드를 친구에게 보내거나 친구의 코드를 입력하세요. 계정당 스탬프는 한 번 받아요." : "Send your code to a friend or enter theirs. Each account earns this Stamp once."}</p><div className={styles.codeRow}>{invite ? <><span className={styles.code}>{invite.code}</span><button className={styles.action} onClick={() => void copyCode()}><Copy aria-hidden="true"/>{ko ? "복사" : "Copy"}</button></> : <button className={styles.action} disabled={busy} onClick={() => void run("invite-code")}>{ko ? "코드 불러오기" : "Load code"}</button>}</div></div>
        <form onSubmit={event => { event.preventDefault(); void run("redeem-invite"); }}><label className={styles.label} htmlFor="community-friend-code">{ko ? "친구 초대코드" : "Friend’s invite code"}</label>{invite?.redeemed ? <p className={styles.help}>{ko ? "친구 코드 인증을 완료했어요." : "You’ve used a friend’s code."}</p> : <div className={styles.codeRow}><input id="community-friend-code" className={styles.codeInput} value={code} onChange={event => setCode(event.target.value.toUpperCase())} minLength={6} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} required/><button className={styles.action} type="submit" disabled={busy || code.trim().length < 6}>{busy ? (ko ? "확인 중" : "Checking") : (ko ? "코드 인증" : "Use code")}</button></div>}</form>
      </div>}
    </>}
    {message && <p role={failed ? "alert" : "status"} className={`${styles.status} ${failed ? styles.error : ""}`}>{message}</p>}
    {visible.length > 0 && <details className={styles.history}><summary>{ko ? "받은 스탬프 전체 보기" : "View all earned Stamps"} · {visible.length}</summary><ul>{visible.map(stamp => <li key={stamp.id}><button onClick={() => setSelected(stamp)}><CommunityStampArtwork kind={stamp.kind} locale={locale} size={48} decorative/><span><strong>{COMMUNITY_STAMPS[stamp.kind][locale]}</strong><small>{stamp.celebritySlug ? `${stamp.celebritySlug} · ` : ""}{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { timeZone:"Asia/Seoul", year:"numeric",month:"short",day:"numeric" }).format(new Date(stamp.issuedAt))}</small></span></button></li>)}</ul></details>}
    {selected && <StampDialog stamp={visible.find(stamp => stamp.id === selected.id) ?? selected} locale={locale} close={() => setSelected(null)}/>}
  </section>;
}
function StampDialog({ stamp, locale, close }: { stamp: CommunityStamp; locale: Locale; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const ko = locale === "ko";
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  const mintText = stamp.mint.status === "minted" ? (ko ? "디지털 발급이 완료됐어요." : "Digital issuance is complete.") : stamp.mint.status === "permanent_failure" ? (ko ? "디지털 발급 상태를 확인하고 있어요." : "We’re checking digital issuance.") : (ko ? "디지털 발급을 준비하고 있어요." : "Your digital edition is being prepared.");
  return <dialog ref={dialog} className={styles.dialog} onCancel={close} onClose={close} aria-labelledby="community-stamp-detail-title"><button className={styles.close} onClick={close} aria-label={ko ? "닫기" : "Close"}><X aria-hidden="true"/></button><CommunityStampArtwork kind={stamp.kind} locale={locale} className={styles.art} size={168} decorative/><h2 id="community-stamp-detail-title">{COMMUNITY_STAMPS[stamp.kind][locale]}</h2><p>{ko ? "받은 날" : "Earned on"} · <time dateTime={stamp.issuedAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Seoul" }).format(new Date(stamp.issuedAt))}</time></p><p>{mintText}</p>{stamp.mint.status === "minted" && stamp.mint.txHash && <a className={styles.action} href={`https://sepolia-explorer.giwa.io/tx/${stamp.mint.txHash}`} target="_blank" rel="noopener noreferrer">{ko ? "발급 기록 보기" : "View issuance record"}</a>}</dialog>;
}
