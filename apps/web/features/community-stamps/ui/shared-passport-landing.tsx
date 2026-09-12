"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Heart } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { bypassImageOptimization } from "@/components/fan-ui/public-image-policy";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

import { communityShareDestinationSchema } from "../domain/community-stamps";
import { communityStampAction } from "./use-community-stamps";
import styles from "./share-passport.module.css";

type Locale = "ko" | "en";
type Creator = { slug: string; name: string; image: { url: string; alt: string } };

function copyFor(locale: Locale) {
  return locale === "ko"
    ? { eyebrow: "BYUS FAN PASSPORT", title: "함께 좋아하는 마음을 만나보세요.", body: "이 패스포트로 연결된 최애 페이지에서 소식과 팬 활동을 확인할 수 있어요.", signedIn: "최애 보기", signing: "최애 페이지를 열고 있어요.", signIn: "로그인하고 최애 보기", ordinary: "최애 페이지로 이동", proof: "최애를 확인하면 링크를 보낸 회원의 공유 스탬프가 기록돼요.", failed: "최애 페이지를 열지 못했어요. 다시 시도해 주세요." }
    : { eyebrow: "BYUS FAN PASSPORT", title: "Meet the favorite that brought you here.", body: "Visit this creator’s page to explore updates and fan moments connected to the Passport.", signedIn: "View favorite", signing: "Opening the creator page.", signIn: "Sign in to view favorite", ordinary: "Go to creator page", proof: "Confirm this favorite and the member who sent the link receives their Share Stamp.", failed: "We couldn't open the creator page. Please try again." };
}

export function SharedPassportLanding({ token, creator, locale }: { token: string; creator: Creator; locale: Locale }) {
  const auth = usePrivy();
  return <SharedPassportLandingInner key={`${auth.user?.id ?? "guest"}:${token}:${creator.slug}:${locale}`} token={token} creator={creator} locale={locale} authenticated={auth.authenticated} ready={auth.ready} getAccessToken={auth.getAccessToken} />;
}

function SharedPassportLandingInner({ token, creator, locale, authenticated, ready, getAccessToken }: { token: string; creator: Creator; locale: Locale; authenticated: boolean; ready: boolean; getAccessToken: () => Promise<string | null> }) {
  const c = copyFor(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const alive = useRef(true);
  const creatorHref = `/c/${creator.slug}?locale=${locale}`;
  const loginHref = `/login?locale=${locale}&returnTo=${encodeURIComponent(`/s/${token}?locale=${locale}`)}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function visit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const result = await communityStampAction(getAccessToken, "share-visit", { token }, (value) => communityShareDestinationSchema.parse(value));
      if (alive.current) router.push(`/c/${result.creator}?locale=${locale}` as Route);
    } catch {
      inFlight.current = false;
      if (alive.current) { setBusy(false); setError(c.failed); }
    }
  }

  return <main className={styles.landing}>
    <section className={styles.landingCard} aria-labelledby="shared-passport-title">
      <div className={styles.eyebrow}><Heart aria-hidden="true" />{c.eyebrow}</div>
      <div className={styles.creatorPortrait}><Image src={creator.image.url} alt={creator.image.alt} width={112} height={112} sizes="112px" unoptimized={bypassImageOptimization(creator.image.url)} /></div>
      <p className={styles.creatorName}>{creator.name}</p>
      <h1 id="shared-passport-title">{c.title}</h1>
      <p className={styles.landingBody}>{c.body}</p>
      <Image className={styles.shareArtwork} src="/images/community-stamps/share.png" alt="" width={96} height={96} />
      {ready && authenticated ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void visit()}>{busy ? c.signing : c.signedIn}<ArrowRight aria-hidden="true" /></button> : ready ? <Link className={styles.primary} href={loginHref as Route}>{c.signIn}<ArrowRight aria-hidden="true" /></Link> : null}
      {ready && authenticated && <p className={styles.proof}>{c.proof}</p>}
      <Link className={styles.secondary} href={creatorHref as Route}>{c.ordinary}</Link>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </main>;
}
