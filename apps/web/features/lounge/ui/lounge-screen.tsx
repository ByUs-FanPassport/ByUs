"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Heart, MessageCircle, Pin, SmilePlus, X } from "lucide-react";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { LOUNGE_EMOJIS, type LoungeMessage } from "../domain/lounge";
import { useLounge } from "./use-lounge";
import styles from "./lounge.module.css";

const ownerKey = (auth: ReturnType<typeof usePrivy>) => `${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}`;
export function LoungeHome({ slug, locale, variant = "preview" }: { slug: string; locale: "ko" | "en"; variant?: "preview" | "count" }) {
  const auth = usePrivy();
  return <HomeForOwner key={`${slug}:${locale}:${ownerKey(auth)}`} {...{ slug, locale, variant }} />;
}
function HomeForOwner({ slug, locale, variant }: { slug: string; locale: "ko" | "en"; variant: "preview" | "count" }) {
  const { data, failed, refresh } = useLounge(slug, locale, 2);
  const ko = locale === "ko";
  const href = `/c/${slug}/lounge?locale=${locale}` as const;
  if (variant === "count") return <div className={styles.heroCount}>{data ? <span><Heart size={14} aria-hidden="true" />{ko ? `좋아요 ${data.likeCount.toLocaleString()}명` : `${data.likeCount.toLocaleString()} likes`}</span> : failed ? <button onClick={refresh}>{ko ? "좋아요 인원 다시 보기" : "Retry like count"}</button> : <span>{ko ? "좋아요 확인 중" : "Loading likes"}</span>}<Link href={href}>{ko ? "팬 라운지" : "Fan lounge"}<ArrowRight size={14} aria-hidden="true" /></Link></div>;
  return <section className={styles.preview} aria-label={ko ? "팬 라운지" : "Fan lounge"}><div className={styles.previewTitle}><MessageCircle aria-hidden="true" /><h2>{ko ? "팬 라운지" : "Fan lounge"}</h2></div><p className={styles.muted}>{ko ? "좋아하는 마음, 함께 나눠요." : "Share what you love with other fans."}</p>
    {!data ? <p role="status">{failed ? (ko ? "대화를 불러오지 못했어요." : "Couldn't load the conversation.") : (ko ? "대화를 불러오고 있어요." : "Loading conversation.")}{failed && <button onClick={refresh}>{ko ? "다시 시도" : "Retry"}</button>}</p> : data.messages.length ? <ul className={styles.previewMessages}>{[...data.messages].reverse().map(message => <li key={message.id}><img src={message.avatarUrl} width={32} height={32} alt="" /><div><strong>{message.nickname}</strong><p>{message.body}</p></div></li>)}</ul> : <p className={styles.emptyPreview}>{ko ? "어떤 순간에 팬이 되셨나요? 첫 이야기를 남겨 보세요." : "What made you a fan? Start the conversation."}</p>}
    <Link className={styles.join} href={href}>{ko ? "대화에 참여하기" : "Join the conversation"}<ArrowRight aria-hidden="true" /></Link>
  </section>;
}
export function LoungeScreen({ celebrity, locale }: { celebrity: Pick<PublishedCelebrity, "slug" | "name" | "image">; locale: "ko" | "en" }) {
  const auth = usePrivy();
  return <RoomForOwner key={`${celebrity.slug}:${locale}:${ownerKey(auth)}`} {...{ celebrity, locale }} />;
}
function RoomForOwner({ celebrity, locale }: { celebrity: Pick<PublishedCelebrity, "slug" | "name" | "image">; locale: "ko" | "en" }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const ko = locale === "ko";
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, failed, refresh, latestMessage } = useLounge(celebrity.slug, locale, 50, cursor);
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<LoungeMessage | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [unknownNew, setUnknownNew] = useState(false);
  const watermark = useRef<LoungeMessage | null>(null);
  const scrolling = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const lastHead = useRef<string | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const attempt = useRef<{ body: string; replyToId: string | null; key: string } | null>(null);
  useEffect(() => { alive.current = true; const active = controllers.current; return () => { alive.current = false; active.forEach(c => c.abort()); }; }, []);
  useEffect(() => {
    if (!data) return;
    const head = data.messages[0]?.id ?? null;
    const first = !lastHead.current;
    const newer = (message: LoungeMessage, anchor: LoungeMessage) => new Date(message.createdAt).getTime() > new Date(anchor.createdAt).getTime() || (message.createdAt === anchor.createdAt && message.id > anchor.id);
    if (watermark.current && latestMessage && newer(latestMessage, watermark.current)) {
      if (cursor) setUnknownNew(true);
      else if (!atBottom.current) {
        const anchor = watermark.current;
        const added = data.messages.filter(message => newer(message, anchor)).length;
        if (!data.messages.some(message => message.id === anchor.id)) setUnknownNew(true);
        else setNewCount(count => count + added);
      }
    }
    if (latestMessage && (!watermark.current || newer(latestMessage, watermark.current))) watermark.current = latestMessage;
    lastHead.current = head;
    if (first || (!cursor && atBottom.current)) scrolling.current?.scrollTo({ top: scrolling.current.scrollHeight });
  }, [data, cursor, latestMessage]);
  function newest() { setCursor(null); setNewCount(0); setUnknownNew(false); atBottom.current = true; lastHead.current = null; refresh(); scrolling.current?.scrollTo({ top: scrolling.current.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  async function mutate(kind: "send" | "delete" | "react", message?: LoungeMessage, emoji?: typeof LOUNGE_EMOJIS[number]) {
    if (sending.current || !authenticated || !ready) return;
    if (kind === "send" && !body.trim()) return;
    sending.current = true; setBusy(true); setError("");
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const token = await getAccessToken();
      if (!alive.current) return;
      if (!token) throw new Error();
      const text = body.trim(), replyToId = reply?.id ?? null;
      if (kind === "send" && (!attempt.current || attempt.current.body !== text || attempt.current.replyToId !== replyToId)) attempt.current = { body: text, replyToId, key: crypto.randomUUID() };
      const url = kind === "send" ? `/api/celebrities/${celebrity.slug}/lounge?locale=${locale}` : `/api/lounge-messages/${message!.id}${kind === "react" ? "/reactions" : ""}`;
      const response = await fetch(url, { method: kind === "send" ? "POST" : kind === "delete" ? "DELETE" : "PUT", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: kind === "delete" ? undefined : JSON.stringify(kind === "send" ? { body: text, replyToId, idempotencyKey: attempt.current!.key } : { emoji, enabled: !message!.reactions.find(r => r.emoji === emoji)?.reacted }) });
      if (!alive.current) return;
      if (!response.ok) { setError(response.status === 429 ? (ko ? "잠시 쉬었다가 다시 보내 주세요." : "Please wait a moment before trying again.") : (ko ? "저장하지 못했어요. 내용을 확인하고 다시 시도해 주세요." : "Couldn't save. Check your message and try again.")); return; }
      if (kind === "send") { setBody(""); setReply(null); attempt.current = null; newest(); composer.current?.focus(); }
      if (kind === "delete" && reply?.id === message?.id) setReply(null);
      setPicker(null); refresh();
    } catch { if (alive.current) setError(ko ? "연결을 확인하고 다시 시도해 주세요." : "Check your connection and try again."); }
    finally { controllers.current.delete(controller); if (alive.current) { sending.current = false; setBusy(false); } }
  }
  const home = `/c/${celebrity.slug}?locale=${locale}` as const;
  const chooseReply = (message: LoungeMessage) => { setReply(message); setPicker(null); composer.current?.focus(); };
  return <FanAppFrame locale={locale} mainId="fan-lounge-main" className={styles.frame}><FanContentContainer as="main" id="fan-lounge-main" tabIndex={-1} className={styles.page}>
    <aside className={styles.sidebar}><img src={celebrity.image.url} alt={celebrity.image.alt} className={styles.creatorPhoto} /><h2>{celebrity.name}</h2><LoungeHome slug={celebrity.slug} locale={locale} variant="count" /><Link href={home}><ArrowLeft aria-hidden="true" />{ko ? "팬페이지로" : "Fan page"}</Link><Link className={styles.noticeLink} href={`/c/${celebrity.slug}?tab=notice&locale=${locale}`}><MessageCircle aria-hidden="true" />{ko ? "공지와 댓글" : "Notices & comments"}</Link><p>{ko ? "새 소식은 공지에서, 팬들과의 이야기는 라운지에서 나눠요." : "Find updates in notices and chat with fellow fans here."}</p></aside>
    <section className={styles.room} aria-label={ko ? "팬 대화" : "Fan conversation"}>
      <header className={styles.roomHeader}><Link href={home} aria-label={ko ? "팬페이지로 돌아가기" : "Back to fan page"}><ArrowLeft /></Link><div><h1>{ko ? `${celebrity.name} 라운지` : `${celebrity.name} lounge`}</h1><p>{ko ? `${celebrity.name} 얘기, 편하게 나눠요.` : `Talk about ${celebrity.name} with fellow fans.`}</p></div><Link className={styles.mobileNotice} href={`/c/${celebrity.slug}?tab=notice&locale=${locale}`}>{ko ? "공지" : "Notices"}</Link></header>
      <div className={styles.starter}><Pin aria-hidden="true" /><p>{ko ? "어떤 순간에 처음 팬이 되셨나요?" : "What first made you a fan?"}</p></div>
      <div className={styles.feedWrap}>
        <div className={styles.feed} ref={scrolling} role="log" aria-label={ko ? "라운지 메시지" : "Lounge messages"} aria-live="off" onScroll={() => { const el = scrolling.current; if (el) { atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; if (atBottom.current && !cursor) { setNewCount(0); setUnknownNew(false); } } }}>
          {data?.nextCursor && <button className={styles.older} onClick={() => { lastHead.current = null; setCursor(data.nextCursor); }}>{ko ? "이전 대화 보기" : "Older messages"}</button>}
          {!data ? <div className={styles.empty} role="status"><MessageCircle aria-hidden="true" /><p>{failed ? (ko ? "대화를 불러오지 못했어요." : "Couldn't load the conversation.") : (ko ? "대화를 불러오고 있어요." : "Loading conversation.")}</p>{failed && <button onClick={refresh}>{ko ? "다시 시도" : "Retry"}</button>}</div> : !data.messages.length ? <div className={styles.empty}><MessageCircle aria-hidden="true" /><h2>{ko ? "첫 이야기를 기다리고 있어요" : "Start the conversation"}</h2><p>{ko ? "좋아하는 영상이나 팬이 된 순간을 나눠 보세요." : "Share a favorite video or the moment you became a fan."}</p></div> : <ol className={styles.messages}>{[...data.messages].reverse().map((message, index, all) => {
            const date = new Date(message.createdAt).toLocaleDateString(ko ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
            const previousDate = index ? new Date(all[index - 1].createdAt).toLocaleDateString(ko ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }) : null;
            return <li key={message.id} data-message-id={message.id}>{date !== previousDate && <p className={styles.date}>{date}</p>}<article className={`${styles.message} ${message.isOwner ? styles.mine : ""}`}>
              {!message.isOwner && <img src={message.avatarUrl} width={32} height={32} alt="" />}<div className={styles.messageContent}><div className={styles.meta}><strong>{message.nickname}{message.isOwner ? (ko ? " · 나" : " · You") : ""}</strong><time dateTime={message.createdAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul", hour12: false }).format(new Date(message.createdAt))}</time></div><div className={styles.bubble}>{message.replyTo && <blockquote>{message.replyTo.body === null ? (ko ? "삭제된 메시지" : "Message removed") : <><strong>{message.replyTo.nickname}</strong> · {message.replyTo.body}</>}</blockquote>}<p>{message.body}</p></div>
              <div className={styles.messageActions}>{message.reactions.map(reaction => <button key={reaction.emoji} disabled={busy || !authenticated} aria-pressed={reaction.reacted} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => void mutate("react", message, reaction.emoji)}>{reaction.emoji} <span>{reaction.count}</span></button>)}{authenticated && <><button aria-label={ko ? `${message.nickname} 메시지에 반응` : `React to ${message.nickname}'s message`} aria-expanded={picker === message.id} disabled={busy} onClick={() => setPicker(picker === message.id ? null : message.id)}><SmilePlus aria-hidden="true" /></button><button disabled={busy} onClick={() => chooseReply(message)}>{ko ? "답장" : "Reply"}</button>{message.isOwner && <button disabled={busy} onClick={() => void mutate("delete", message)}>{ko ? "삭제" : "Delete"}</button>}</>}</div>
              {picker === message.id && <div className={styles.emojiPicker} aria-label={ko ? "반응 고르기" : "Choose a reaction"} onKeyDown={event => { if (event.key === "Escape") setPicker(null); }}>{LOUNGE_EMOJIS.map(emoji => <button key={emoji} aria-label={emoji} disabled={busy} onClick={() => void mutate("react", message, emoji)}>{emoji}</button>)}</div>}
            </div></article></li>;
          })}</ol>}
        </div>
        {(cursor || newCount > 0 || unknownNew) && <button className={styles.newMessages} onClick={newest}>{newCount > 0 || unknownNew ? (ko ? `새 메시지${!unknownNew && newCount ? ` ${newCount}` : ""}` : `New messages${!unknownNew && newCount ? ` ${newCount}` : ""}`) : (ko ? "최신 대화로" : "Latest messages")}<ArrowDown aria-hidden="true" /></button>}
      </div>
      <div className={styles.composerArea}>
        {failed && data && <p className={styles.connection} role="status">{ko ? "연결을 다시 확인하고 있어요." : "Reconnecting…"}<button onClick={refresh}>{ko ? "다시 시도" : "Retry"}</button></p>}
        {ready && authenticated ? <form onSubmit={event => { event.preventDefault(); void mutate("send"); }}>
          {reply && <div className={styles.replyDraft}><div><strong>{ko ? `${reply.nickname}에게 답장` : `Replying to ${reply.nickname}`}</strong><p>{data?.messages.some(m => m.id === reply.id) ? reply.body : (ko ? "선택한 메시지에 답장" : "Reply to selected message")}</p></div><button type="button" aria-label={ko ? "답장 취소" : "Cancel reply"} onClick={() => setReply(null)}><X /></button></div>}
          <div className={styles.composer}><textarea ref={composer} aria-label={ko ? "메시지" : "Message"} placeholder={ko ? "팬들과 이야기를 나눠 보세요" : "Share a thought with fellow fans"} value={body} maxLength={1000} rows={1} disabled={busy} onChange={event => setBody(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void mutate("send"); } }} /><button type="button" aria-label={ko ? "메시지 이모지" : "Message emoji"} aria-expanded={picker === "composer"} disabled={busy} onClick={() => setPicker(picker === "composer" ? null : "composer")}><SmilePlus /></button><button type="submit" className={styles.send} disabled={busy || !body.trim()} aria-label={ko ? "메시지 보내기" : "Send message"}><ArrowUp /></button></div>
          {picker === "composer" && <div className={styles.emojiPicker}>{LOUNGE_EMOJIS.map(emoji => <button key={emoji} type="button" onClick={() => { setBody(text => text.length + emoji.length <= 1000 ? text + emoji : text); setPicker(null); composer.current?.focus(); }}>{emoji}</button>)}</div>}
          <p className={styles.guideline}>{ko ? "닉네임과 아바타가 공개돼요. 서로를 존중하며 이야기해요." : "Your nickname and avatar are public. Be kind to one another."}</p>
        </form> : ready ? <Link className={styles.join} href={`/login?locale=${locale}&returnTo=${encodeURIComponent(`/c/${celebrity.slug}/lounge?locale=${locale}`)}`}>{ko ? "로그인하고 대화에 참여하기" : "Sign in to join the conversation"}<ArrowRight /></Link> : null}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </section>
  </FanContentContainer></FanAppFrame>;
}
