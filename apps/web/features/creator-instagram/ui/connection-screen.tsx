"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { BadgeCheck, Radio, Images, Check, Unplug, CircleAlert, ArrowLeft } from "lucide-react";
import { FocusFlowHeader } from "../../../components/fan-shell/focus-flow-header";
import { FanAction } from "../../../components/fan-ui/fan-action";
import { CreatorAvatar } from "../../../components/fan-ui/creator-avatar";
import type { CreatorInstagramAccount, CreatorInstagramScreen } from "../domain/connection";
import styles from "./connection-screen.module.css";

type Props = {
  locale: "ko" | "en";
  screen: CreatorInstagramScreen;
  account: CreatorInstagramAccount | null;
  accounts?: CreatorInstagramAccount[];
  signedIn: boolean;
  busy?: boolean;
  error?: string;
  notice?: string;
  onStart(): void;
  onConfirm(): void;
  onCancel(): void;
  onToggle(): void;
  onDisconnect(): void;
  onScreen(screen: CreatorInstagramScreen): void;
  onSelect?(id: string): void;
};

export function ConnectionScreen(props: Props) {
  const { locale, screen, account, accounts = [], signedIn, busy, error, notice, onStart, onConfirm, onCancel, onToggle, onDisconnect, onScreen, onSelect } = props;
  const ko = locale === "ko";
  const t = (k: string, e: string) => ko ? k : e;
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(screen);
  useEffect(() => { if (previous.current !== screen) heading.current?.focus(); previous.current = screen; }, [screen]);
  const intro = screen === "intro";
  const title = screen === "confirm" ? t(`${account?.name ?? ""}님의 팬페이지에\n연결할까요?`, `Connect to ${account?.name ?? "your"}'s fan page?`)
    : screen === "manage" ? account?.needsReconnect ? t("Instagram을 다시 연결해 주세요", "Reconnect Instagram") : t(`${account?.name ?? ""}님의 계정이 연결됐어요`, `${account?.name ?? "Your"} Instagram is connected`)
    : screen === "permissions" ? t("이용하는 정보와 권한", "Information and permissions")
    : screen === "mismatch" ? t("등록된 팬페이지를\n찾지 못했어요", "We couldn't find a matching fan page")
    : screen === "disconnect" ? t("Instagram 연결을\n해제할까요?", "Disconnect Instagram?")
    : t("Instagram을 연결하고\n라이브 소식을 전하세요", "Connect Instagram.\nShare your live moments.");
  const back = () => onScreen(account ? "manage" : "intro");
  const accountCard = account && <div className={styles.account}>
    <CreatorAvatar slug={account.slug} src={account.avatarUrl} photos={undefined} size={64} />
    <div><strong>{account.name}</strong><span>@{account.username}</span></div>
  </div>;
  const footer = <footer className={styles.footer}>
    <button onClick={() => onScreen("permissions")}>{t("이용하는 정보와 권한", "Information and permissions")}</button>
    <a href={`/my/inquiries?locale=${locale}`}>{t("도움이 필요해요", "Get help")}</a>
  </footer>;
  const features = [
    { Icon: BadgeCheck, title: t("내 계정 확인", "Confirm your account"), body: t("등록된 계정과 대조해\n내 Instagram 계정인지 확인해요.", "We match your Instagram identity with your registered fan page.") },
    { Icon: Radio, title: t("라이브를 시작하면, 팬들이 찾아오도록", "Help fans find your LIVE"), body: t("방송이 감지되면 ByUs 홈과 LIVE에\n방송 중 상태와 시청 링크를 표시해요.", "When a LIVE is detected, ByUs Home and LIVE show its status and watch link.") },
    { Icon: Images, title: t("최근 소식도 팬페이지에", "Recent moments on your fan page"), body: t("최근 사진과 릴스를 팬들이 확인할 수 있어요.", "Fans can discover your recent photos and reels.") },
  ];
  const permissions = [
    [t("내 Instagram 계정 확인", "Confirm your Instagram account"), t("Instagram 계정 ID와 사용자명을 확인해 ByUs에 등록된 팬페이지와 연결해요.", "We use your Instagram account ID and username to match your registered ByUs fan page.")],
    [t("팬들에게 표시하는 정보", "Information shown to fans"), t("LIVE 진행 상태와 시청 링크, 최근 사진·릴스의 설명과 게시 시각, 원본 링크를 조회해 팬페이지에 표시해요.", "We read LIVE status and watch links, recent photos and reels, their captions, publication times and original links for your fan page.")],
    [t("요청하지 않는 권한", "Permissions we do not request"), t("게시물 작성·게시, 댓글 관리·작성, DM 조회·전송 권한은 요청하지 않아요.", "We do not request access to publish posts, manage comments, or read or send DMs.")],
    [t("비밀번호는 받지 않아요", "Your password stays with Instagram"), t("로그인은 Instagram 공식 화면에서 진행해요. ByUs는 연결 유지에 필요한 접근 정보를 암호화해 저장해요.", "Sign-in happens on Instagram's official screen. ByUs stores the access credentials needed for the connection in encrypted form.")],
    [t("연결을 해제하면", "When you disconnect"), t("ByUs에 저장한 해당 Instagram 계정 정보와 접근 정보, 수집한 게시물 정보를 삭제해요. Instagram 설정에서도 접근 권한을 철회할 수 있어요.", "We remove the connected Instagram identity, credentials and collected media from ByUs. You can also revoke access in Instagram settings.")],
    [t("팬 활동 기록은 별도로 유지해요", "Fan activity is kept separately"), t("Instagram 팔로워 목록은 가져오지 않아요. ByUs에서의 참여와 활동 기록은 별도로 유지돼요.", "We do not import Instagram follower lists. Fans' participation and activity on ByUs remain separate.")],
  ];
  return <div className={styles.page}>
    <FocusFlowHeader locale={locale} mainId="creator-content" className={styles.header} innerClassName={styles.headerInner}>
      <span className={styles.service}>{t("계정 연결", "Account connection")}</span>
      <a className={styles.myAccount} href={signedIn ? `/my?locale=${locale}` : `/login?locale=${locale}&returnTo=${encodeURIComponent(`/connect/instagram?locale=${locale}`)}`}>
        {signedIn && <Image src="/images/avatars/fairy-cream.webp" alt="" width={28} height={28} />}
        <span>{signedIn ? t("내 계정", "My account") : t("로그인", "Sign in")}</span>
      </a>
    </FocusFlowHeader>
    <main id="creator-content" className={`${styles.main} ${intro ? styles.intro : screen === "manage" ? styles.management : styles.narrow}`} aria-busy={busy || undefined}>
      {intro && <div className={styles.steps}><span>{t("1  연결 안내", "1  Connection guide")}</span><small>{t("계정 확인 → 연결 완료", "Confirm account → Connected")}</small></div>}
      {screen === "confirm" && <div className={styles.steps}><span>{t("2  계정 확인", "2  Confirm account")}</span></div>}
      {screen === "manage" && <div className={styles.steps}><span className={account?.needsReconnect ? undefined : styles.success}>{account?.needsReconnect ? t("다시 연결 필요", "Reconnect required") : t("Instagram 연결 완료", "Instagram connected")}</span></div>}
      {screen === "permissions" && <button className={styles.textButton} onClick={back}><ArrowLeft size={16} aria-hidden="true" />{t("돌아가기", "Back")}</button>}
      {screen === "mismatch" && <CircleAlert className={styles.stateIcon} size={40} aria-hidden="true" />}
      {screen === "disconnect" && <Unplug className={styles.stateIcon} size={36} aria-hidden="true" />}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={intro ? styles.introGrid : styles.stack}>
        <div className={intro ? styles.benefits : styles.stack}>
          {intro && <p className={styles.eyebrow}>{t("팬들에게 전하는 라이브 소식", "Your live moments, closer to fans")}</p>}
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          {intro && <><p className={styles.description}>{t("내 Instagram 계정을 연결하면, 방송이 감지될 때\n팬들이 ByUs에서 시청 링크를 확인할 수 있어요.", "Connect your Instagram so fans can find your watch link on ByUs when a LIVE is detected.")}</p>
            <div className={styles.featureList}>{features.map(({ Icon, title, body }) => <div className={styles.feature} key={title}><Icon size={24} aria-hidden="true" /><div><h2>{title}</h2><p>{body}</p></div></div>)}</div></>}
        </div>
        {intro && <section className={styles.permissionCard} aria-label={t("연결 권한", "Connection permissions")}>
          <h2>{t("필요한 읽기 권한만 요청해요", "Only the read access we need")}</h2><p>{t("확인하는 정보", "Information we read")}</p><p>{t("계정 정보 · LIVE 상태와 시청 링크\n최근 사진·릴스와 게시물 정보", "Account information, LIVE status and watch links, recent photos, reels and post information")}</p>
          <ul>{[t("게시물 작성·게시 권한 없음", "No permission to publish posts"), t("댓글 관리·작성 권한 없음", "No permission to manage comments"), t("DM 조회·전송 권한 없음", "No permission to read or send DMs")].map(x => <li key={x}><Check size={16} aria-hidden="true" />{x}</li>)}</ul>
          <p className={styles.caption}>{t("비밀번호는 Instagram에서 직접 입력하며\nByUs는 비밀번호를 받거나 저장하지 않아요.", "Enter your password directly on Instagram. ByUs never receives or stores it.")}</p>
          <FanAction variant="primary" fullWidth disabled={busy} onClick={onStart}>{busy ? t("확인 중…", "Checking…") : t("Instagram 연결하기", "Connect Instagram")}</FanAction>
          <p className={styles.hint}>{t("크리에이터 또는 비즈니스 계정이 필요해요.", "A creator or business account is required.")}</p>
          {!signedIn && <p className={styles.hint}>{t("먼저 ByUs에 로그인한 뒤 연결을 이어가요.", "Sign in to ByUs first, then continue connecting.")}</p>}
        </section>}
      </div>
      {intro && <div className={styles.notes}><div><h2>{t("언제든 직접 관리", "Stay in control")}</h2><p>{t("자동 표시를 끄거나 계정 연결을 해제할 수 있어요.", "Turn off LIVE display or disconnect your account.")}</p></div><div><h2>{t("팬 정보는 ByUs 활동 기준", "Fan activity stays on ByUs")}</h2><p>{t("Instagram 팔로워 목록을 가져오지 않아요.", "We do not import Instagram follower lists.")}</p></div></div>}
      {screen === "confirm" && account && <div className={styles.stack}>
        <p>{t("Instagram에서 확인한 계정이에요.\n연결할 팬페이지와 계정이 맞는지 확인해 주세요.", "This account was verified by Instagram. Check that the account and fan page are yours.")}</p>{accountCard}
        <div><h2>{t("연결할 ByUs 팬페이지", "Your ByUs fan page")}</h2><p>{account.name}</p></div><hr />
        <div><h2>{t("연결하면 시작되는 기능", "After connecting")}</h2><p>{t("LIVE 자동 표시 · 최근 사진과 릴스 표시", "LIVE display · Recent photos and reels")}</p></div>
        <div><h2>{t("LIVE가 감지되면", "When a LIVE is detected")}</h2><p>{t("ByUs 홈과 LIVE에 방송 중 상태와 시청 링크를 표시해요. 연결 후 자동 표시를 끌 수 있어요.", "ByUs Home and LIVE show its status and watch link. You can turn this off after connecting.")}</p></div>
        <FanAction variant="primary" fullWidth disabled={busy} onClick={onConfirm}>{busy ? t("연결 중…", "Connecting…") : t("이 계정 연결하기", "Connect this account")}</FanAction>
        <FanAction fullWidth disabled={busy} onClick={onCancel}>{t("다른 Instagram 계정으로 연결", "Use another Instagram account")}</FanAction>
        <p className={styles.hint}>{t("현재 로그인한 ByUs 계정에 연결돼요.", "This connects to your currently signed-in ByUs account.")}</p>
      </div>}
      {screen === "manage" && account && <div className={styles.stack}>
        <p>{account.needsReconnect ? t("Instagram 동의가 만료되었거나 철회됐어요. 다시 연결하면 소식을 이어서 표시할 수 있어요.", "Instagram access expired or was revoked. Reconnect to resume updates.") : t("라이브가 감지되면 ByUs에 방송 중 상태와 시청 링크를 표시해요.", "When a LIVE is detected, ByUs shows its status and watch link.")}</p>
        {accounts.length > 1 && <label className={styles.picker}>{t("연결 계정 선택", "Select a connected account")}<select value={account.celebrityId} onChange={e => onSelect?.(e.target.value)} disabled={busy}>{accounts.map(a => <option key={a.celebrityId} value={a.celebrityId}>{a.name} · @{a.username}</option>)}</select></label>}
        {accountCard}
        <section className={styles.settings} aria-label={t("Instagram 연동 설정", "Instagram connection settings")}>
          <div className={styles.toggleRow}><div><h2 id="live-display-label">{t("LIVE 자동 표시", "Automatic LIVE display")}</h2><p id="live-display-help">{t("방송이 감지되면 ByUs 홈과 LIVE에 시청 링크를 표시해요.", "Show detected LIVE watch links on ByUs Home and LIVE.")}</p></div><button className={styles.toggleButton} role="switch" aria-checked={account.liveEnabled} aria-labelledby="live-display-label" aria-describedby="live-display-help" disabled={busy || account.needsReconnect} onClick={onToggle}><span>{account.liveEnabled ? t("켜짐", "On") : t("꺼짐", "Off")}</span><span className={styles.switch} /></button></div>
          <hr /><div><h2>{t("방송 전에도 연결 상태는 유지돼요", "Stay connected between broadcasts")}</h2><p>{t("지금 방송 중이 아니어도 괜찮아요. 연결은 자동으로 갱신하고, 다시 동의가 필요하면 이 화면에서 확인할 수 있어요.", "You don't need to be live now. We refresh access automatically; this page shows when you need to reconnect.")}</p></div>
          <div className={styles.mediaRow}><h2>{t("최근 사진과 릴스", "Recent photos and reels")}</h2><span>{account.needsReconnect ? t("다시 연결 필요", "Reconnect required") : account.mediaStatus === "connected" ? t("연동 중", "Connected") : account.mediaStatus === "syncing" ? t("확인 중", "Syncing") : t("일시적으로 확인할 수 없어요", "Temporarily unavailable")}</span></div>
        </section>
        <div className={styles.mainAction}>{account.needsReconnect ? <FanAction variant="primary" fullWidth disabled={busy} onClick={onStart}>{t("Instagram 다시 연결하기", "Reconnect Instagram")}</FanAction> : <FanAction variant="primary" fullWidth href={`/c/${account.slug}?locale=${locale}`}>{t("내 팬페이지 보기", "View my fan page")}</FanAction>}</div>
        <section className={styles.disconnectArea}><button className={styles.textButton} disabled={busy} onClick={() => onScreen("disconnect")}>{t("Instagram 연결 해제", "Disconnect Instagram")}</button><p>{t("연결을 해제하면 Instagram 정보 조회와 자동 표시가 중단돼요.\nByUs의 팬 활동 기록은 삭제되지 않아요.", "Disconnecting stops Instagram updates and automatic display. Fan activity on ByUs is not deleted.")}</p></section>
      </div>}
      {screen === "permissions" && <div className={styles.stack}>{permissions.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}<FanAction variant="primary" fullWidth onClick={back}>{t("돌아가기", "Back")}</FanAction><a className={styles.textButton} href={`/privacy?locale=${locale}`}>{t("개인정보처리방침 보기", "Privacy policy")}</a></div>}
      {screen === "mismatch" && <div className={styles.stack}><p>{t("로그인한 Instagram 계정과 일치하는 팬페이지를 확인할 수 없어요. 아직 계정은 연결되지 않았어요.", "We couldn't verify a fan page for the signed-in Instagram account. Nothing has been connected.")}</p><div><h2>{t("여러 계정을 사용하시나요?", "Using more than one account?")}</h2><p>{t("연결할 팬페이지의 Instagram 계정으로 다시 로그인해 주세요.", "Sign in again with the Instagram account registered on your fan page.")}</p></div><FanAction variant="primary" fullWidth disabled={busy} onClick={onStart}>{t("다른 Instagram 계정으로 연결", "Use another Instagram account")}</FanAction><FanAction fullWidth href={`/my/inquiries?locale=${locale}`}>{t("ByUs 담당자에게 문의", "Contact ByUs")}</FanAction><button className={styles.textButton} onClick={() => onScreen("intro")}>{t("연결 안내로 돌아가기", "Back to connection guide")}</button></div>}
      {screen === "disconnect" && account && <div className={styles.stack}>{accountCard}<div><h2>{t("중단되는 기능", "What stops")}</h2><p>{t("LIVE 자동 표시와 최근 사진·릴스 조회가 중단돼요. ByUs에 저장된 Instagram 연결 정보도 삭제해요.", "LIVE display and recent photos and reels stop updating. Your Instagram connection information is removed from ByUs.")}</p></div><div><h2>{t("유지되는 정보", "What stays")}</h2><p>{t("ByUs에 남아 있는 팬들의 참여와 활동 기록은 삭제되지 않아요.", "Fans' participation and activity records on ByUs are not deleted.")}</p></div><div className={styles.alternative}><h2>{t("LIVE 표시만 잠시 끄고 싶다면", "Only pausing LIVE display?")}</h2><p>{t("연결을 유지한 채 LIVE 자동 표시만 끌 수 있어요.", "Keep the connection and turn off automatic LIVE display.")}</p></div><FanAction variant="primary" fullWidth disabled={busy} onClick={() => onScreen("manage")}>{t("연결 유지하기", "Keep connected")}</FanAction><FanAction fullWidth disabled={busy} onClick={onDisconnect}>{busy ? t("해제 중…", "Disconnecting…") : t("Instagram 연결 해제", "Disconnect Instagram")}</FanAction></div>}
      {screen !== "permissions" && footer}
    </main>
  </div>;
}
