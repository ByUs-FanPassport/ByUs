"use client";

import { messages as localizedMessages } from "@/i18n/catalogs/features__community-stamps__ui__community-stamp-collection";
import { translate, additionalLocales } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

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

type Locale = AppLocale;
type Resource = ReturnType<typeof useCommunityStamps>;
function errorCopy(error: unknown, locale: Locale) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, Record<AppLocale, string>> = {
    COMMUNITY_STAMP_SELF_INVITE: { ko: "내 코드는 입력할 수 없어요.", en: "You can’t use your own code." ,
  ...additionalLocales((translationLocale) => (localizedMessages.m4ea3e8203ad1[translationLocale]))
},
    COMMUNITY_STAMP_ALREADY_REDEEMED: { ko: "이미 친구 코드를 인증했어요.", en: "You’ve already used a friend’s code." ,
  ...additionalLocales((translationLocale) => (localizedMessages.m991e1d0428af[translationLocale]))
},
    COMMUNITY_STAMP_NOT_FOUND: { ko: "코드 또는 최애 정보를 확인해 주세요.", en: "Check the code or creator and try again." ,
  ...additionalLocales((translationLocale) => (localizedMessages.m14409b885cde[translationLocale]))
},
    COMMUNITY_STAMP_WALLET_NOT_READY: { ko: "스탬프를 받을 준비 중이에요. 잠시 후 다시 시도해 주세요.", en: "Your Stamps are getting ready. Please try again shortly." ,
  ...additionalLocales((translationLocale) => (localizedMessages.mf7203cb5f875[translationLocale]))
},
    AUTHENTICATION_REQUIRED: { ko: "다시 로그인해 주세요.", en: "Please sign in again." ,
  ...additionalLocales((translationLocale) => (localizedMessages.m2de144ed728f[translationLocale]))
},
  };
  return (messages[code] ?? { ko: "완료하지 못했어요. 다시 시도해 주세요.", en: "Couldn’t complete this. Please try again." ,
  ...additionalLocales((translationLocale) => (localizedMessages.mb811b50fbce4[translationLocale]))
})[locale];
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
          setMessage(result.awarded ? (locale === "ko" ? "새 스탬프가 기록됐어요." : translate(locale, localizedMessages.m065af5f17fbb, "Your new Stamp has been recorded.")) : (locale === "ko" ? "이미 받은 스탬프예요." : translate(locale, localizedMessages.m3c048733aea8, "You’ve already earned this Stamp.")));
          if (action === "redeem-invite") setInvite(current => current ? { ...current, redeemed: true } : current);
          resource.retry(); notifyFanActivityUpdated(auth.user?.id);
        }
      }
    } catch (error) { if (alive.current) { setMessage(errorCopy(error, locale)); setFailed(true); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(invite!.code); if (alive.current) { setFailed(false); setMessage(locale === "ko" ? "초대코드를 복사했어요." : translate(locale, localizedMessages.m8e680bc0e71f, "Invite code copied.")); } }
    catch { if (alive.current) { setFailed(true); setMessage(locale === "ko" ? "코드를 선택해서 복사해 주세요." : translate(locale, localizedMessages.mc314a8314602, "Select the code to copy it.")); } }
  }
  return <section className={styles.section} id="community-stamps" aria-labelledby="community-stamps-title">
    <div className={styles.heading}><div><h2 id="community-stamps-title">{locale === "ko" ? "스탬프 모으기" : translate(locale, localizedMessages.m7a8ba5792eaa, "Collect Stamps")}</h2><p>{creator ? (locale === "ko" ? "최애와 함께한 일상을 차곡차곡 모아요." : translate(locale, localizedMessages.m25f2023407fb, "Collect everyday moments with your favorite.")) : (locale === "ko" ? "첫 인사부터 매일의 출석까지, 나만의 팬 기록." : translate(locale, localizedMessages.m07087be1eb13, "From your first hello to everyday check-ins.") )}</p></div>{resource.state.status === "ready" && <span className={styles.count}>{locale === "ko" ? `${visible.length}개 수집` : translate(locale, localizedMessages.mcc9d0c254436, "{0} collected", [visible.length])}</span>}</div>
    {resource.state.status === "loading" ? <p className={styles.status} role="status">{locale === "ko" ? "스탬프를 불러오고 있어요." : translate(locale, localizedMessages.m14ba0b095bf9, "Loading your Stamps.")}</p>  : resource.state.status === "error" && resource.state.kind === "missing" && creator ? <div className={styles.status} role="status"><p>{locale === "ko" ? "현재 이 최애의 스탬프 활동을 이용할 수 없어요." : translate(locale, localizedMessages.m3f3e69fa36eb, "Stamp activities for this artist are currently unavailable.")}</p><Link className={styles.action} href={`/my?locale=${locale}#community-stamps` as Route}>{locale === "ko" ? "내 스탬프 보기" : translate(locale, localizedMessages.mb43cbc171691, "View my Stamps")}</Link></div> : resource.state.status === "error" ? <p className={styles.status} role="alert">{locale === "ko" ? "스탬프를 불러오지 못했어요." : translate(locale, localizedMessages.m6f4e687b2a1d, "Couldn’t load your Stamps.")} <button className={styles.action} onClick={resource.retry}><RotateCcw aria-hidden="true"/>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.mf721ef255caa, "Try again")}</button></p> : <>
      {resource.refreshFailed && <p role="alert" className={styles.status}>{locale === "ko" ? "최신 기록을 확인하지 못했어요." : translate(locale, localizedMessages.m4bdba754452a, "Couldn’t refresh your Stamps.")} <button className={styles.action} onClick={resource.retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m11bce3427a8f, "Retry")}</button></p>}
      <ul className={styles.grid}>{kinds.map(kind => {
        const stamp = earned(kind); const info = COMMUNITY_STAMPS[kind];
        const href = creator ? `${creatorHomeHref(creator)}?locale=${locale}${kind === "daily_checkin" ? "#daily-checkin" : "#cheers"}` : kind === "share" ? `/passports?locale=${locale}` : `/celebrities?locale=${locale}`;
        return <li className={styles.card} data-earned={!!stamp} key={kind}>
          <CommunityStampArtwork kind={kind} locale={locale} className={styles.art} decorative/>
          <h3>{info[locale]}</h3>{stamp && <span className={styles.state}><Check aria-hidden="true"/>{locale === "ko" ? "획득" : translate(locale, localizedMessages.ma5f24c183a36, "Earned")}</span>}
          <p>{ko ? info.koHelp : info.enHelp}</p>
          {stamp ? <div className={styles.cardActions}><button className={styles.action} onClick={() => setSelected(stamp)}>{locale === "ko" ? "스탬프 보기" : translate(locale, localizedMessages.mc4481ae2313e, "View Stamp")}</button>{kind === "share" && creator && <SharePassport creator={{ slug: creator, name: creator }} locale={locale}/>}</div> : kind === "welcome" ? <button className={styles.action} disabled={busy} onClick={() => void run("welcome")}>{locale === "ko" ? "가입 스탬프 받기" : translate(locale, localizedMessages.m41ade7763a1c, "Get welcome Stamp")}</button> : kind === "invite" ? <button className={styles.action} disabled={busy} onClick={() => { setInviteOpen(true); void run("invite-code"); }}>{locale === "ko" ? "친구 초대하기" : translate(locale, localizedMessages.ma5023c1cc581, "Invite a friend")}</button> : kind === "share" && creator ? <SharePassport creator={{ slug: creator, name: creator }} locale={locale}/> : <Link className={styles.action} href={href as Route}>{kind === "daily_checkin" ? (locale === "ko" ? "출석하러 가기" : translate(locale, localizedMessages.md29cb19a1b1d, "Check in")) : kind === "share" ? (locale === "ko" ? "패스포트 고르기" : translate(locale, localizedMessages.m3442db55dbf6, "Choose a Passport")) : (locale === "ko" ? "댓글 남기기" : translate(locale, localizedMessages.m2e60da1bfeff, "Leave a comment"))}</Link>}
        </li>;
      })}</ul>
      {!creator && earned("invite") && !inviteOpen && <button className={styles.action} onClick={() => { setInviteOpen(true); void run("invite-code"); }}>{locale === "ko" ? "내 초대코드" : translate(locale, localizedMessages.me2bf91513187, "My invite code")}</button>}
      {inviteOpen && !creator && <div className={styles.invite}>
        <div><h3>{locale === "ko" ? "친구와 함께 받는 스탬프" : translate(locale, localizedMessages.m31e0038fddfe, "A Stamp for both of you")}</h3><p className={styles.help}>{locale === "ko" ? "내 코드를 친구에게 보내거나 친구의 코드를 입력하세요. 계정당 스탬프는 한 번 받아요." : translate(locale, localizedMessages.m100712960346, "Send your code to a friend or enter theirs. Each account earns this Stamp once.")}</p><div className={styles.codeRow}>{invite ? <><span className={styles.code}>{invite.code}</span><button className={styles.action} onClick={() => void copyCode()}><Copy aria-hidden="true"/>{locale === "ko" ? "복사" : translate(locale, localizedMessages.m8cb1f88e95a6, "Copy")}</button></> : <button className={styles.action} disabled={busy} onClick={() => void run("invite-code")}>{locale === "ko" ? "코드 불러오기" : translate(locale, localizedMessages.m12ad022ac356, "Load code")}</button>}</div></div>
        <form onSubmit={event => { event.preventDefault(); void run("redeem-invite"); }}><label className={styles.label} htmlFor="community-friend-code">{locale === "ko" ? "친구 초대코드" : translate(locale, localizedMessages.mb0c189def1dc, "Friend’s invite code")}</label>{invite?.redeemed ? <p className={styles.help}>{locale === "ko" ? "친구 코드 인증을 완료했어요." : translate(locale, localizedMessages.m6377374626db, "You’ve used a friend’s code.")}</p> : <div className={styles.codeRow}><input id="community-friend-code" className={styles.codeInput} value={code} onChange={event => setCode(event.target.value.toUpperCase())} minLength={6} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} required/><button className={styles.action} type="submit" disabled={busy || code.trim().length < 6}>{busy ? (locale === "ko" ? "확인 중" : translate(locale, localizedMessages.m92e882a00096, "Checking")) : (locale === "ko" ? "코드 인증" : translate(locale, localizedMessages.m7d3af7aab389, "Use code"))}</button></div>}</form>
      </div>}
    </>}
    {message && <p role={failed ? "alert" : "status"} className={`${styles.status} ${failed ? styles.error : ""}`}>{message}</p>}
    {visible.length > 0 && <details className={styles.history}><summary>{locale === "ko" ? "받은 스탬프 전체 보기" : translate(locale, localizedMessages.me6921f55a8b4, "View all earned Stamps")} · {visible.length}</summary><ul>{visible.map(stamp => <li key={stamp.id}><button onClick={() => setSelected(stamp)}><CommunityStampArtwork kind={stamp.kind} locale={locale} size={48} decorative/><span><strong>{COMMUNITY_STAMPS[stamp.kind][locale]}</strong><small>{stamp.celebritySlug ? `${stamp.celebritySlug} · ` : ""}{new Intl.DateTimeFormat(locale, { calendar: "gregory", timeZone:"Asia/Seoul", year:"numeric",month:"short",day:"numeric" }).format(new Date(stamp.issuedAt))}</small></span></button></li>)}</ul></details>}
    {selected && <StampDialog stamp={visible.find(stamp => stamp.id === selected.id) ?? selected} locale={locale} close={() => setSelected(null)}/>}
  </section>;
}
function StampDialog({ stamp, locale, close }: { stamp: CommunityStamp; locale: Locale; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const ko = locale === "ko";
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  const mintText = stamp.mint.status === "minted" ? (locale === "ko" ? "스탬프 발급이 완료됐어요." : translate(locale, localizedMessages.mb2d78c607ac6, "Your Stamp has been issued.")) : stamp.mint.status === "permanent_failure" ? (locale === "ko" ? "스탬프 발급 상태를 확인하고 있어요." : translate(locale, localizedMessages.ma9cc402faf99, "We’re checking your Stamp’s issuance status.")) : (locale === "ko" ? "스탬프 발급을 준비하고 있어요." : translate(locale, localizedMessages.mb7d9b53a9daa, "Your Stamp is being prepared."));
  return <dialog ref={dialog} className={styles.dialog} onCancel={close} onClose={close} aria-labelledby="community-stamp-detail-title"><button className={styles.close} onClick={close} aria-label={locale === "ko" ? "닫기" : translate(locale, localizedMessages.m3fe0e05ee0cd, "Close")}><X aria-hidden="true"/></button><CommunityStampArtwork kind={stamp.kind} locale={locale} className={styles.art} size={168} decorative/><h2 id="community-stamp-detail-title">{COMMUNITY_STAMPS[stamp.kind][locale]}</h2><p>{locale === "ko" ? "받은 날" : translate(locale, localizedMessages.m73886047197c, "Earned on")} · <time dateTime={stamp.issuedAt}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Seoul" }).format(new Date(stamp.issuedAt))}</time></p><p>{mintText}</p>{stamp.mint.status === "minted" && stamp.mint.txHash && <a className={styles.action} href={`https://sepolia-explorer.giwa.io/tx/${stamp.mint.txHash}`} target="_blank" rel="noopener noreferrer">{locale === "ko" ? "발급 기록 보기" : translate(locale, localizedMessages.ma33046b6d7ff, "View issuance record")}</a>}</dialog>;
}
