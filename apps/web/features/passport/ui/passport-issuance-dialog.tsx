"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";

import { AuthIntentLink } from "@/components/auth-intent-link";
import { parseIssuanceAggregate, type IssuanceAggregate } from "../domain/issuance-aggregate";
import styles from "./passport-issuance-dialog.module.css";

interface PassportIssuanceCeremonyProps { issuance: IssuanceAggregate }

function issuanceStatus(issuance: IssuanceAggregate): string {
  const statuses = [issuance.passport.mintStatus, issuance.firstStamp.mintStatus];
  if (statuses.every((status) => status === "minted")) return "디지털 발급 완료";
  if (statuses.some((status) => status === "retryable" || status === "permanent_failure")) {
    return "발급 상태 확인 중";
  }
  if (statuses.some((status) => status === "processing")) return "디지털 발급 확인 중";
  return "디지털 발급 준비 중";
}

export function PassportIssuanceCeremony({ issuance }: PassportIssuanceCeremonyProps) {
  const [stage, setStage] = useState(0);
  const [stampImageFailed, setStampImageFailed] = useState(false);

  useEffect(() => {
    function completeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStage(3);
    };
    document.addEventListener("keydown", completeOnEscape);
    return () => document.removeEventListener("keydown", completeOnEscape);
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      setStage(3);
      return;
    }
    const timers = [
      window.setTimeout(() => setStage(1), 450),
      window.setTimeout(() => setStage(2), 900),
      window.setTimeout(() => setStage(3), 1_350),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, []);

  const date = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(issuance.firstStamp.issuedAt));

  return (
    <main
      className={styles.screen}
      aria-labelledby="passport-issuance-title"
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <Link className={styles.wordmark} href="/" aria-label="ByUs 홈">
            <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority />
          </Link>
          <div className={styles.progress} aria-label="발급 과정 4단계 중 3단계">
            <span>3 / 4</span><i aria-hidden="true" />
          </div>
          <Link className={styles.skip} href={`/passports/${issuance.passport.id}` as Route}>
            건너뛰기
          </Link>
        </header>

        <div className={styles.content}>
          <section className={styles.passport} aria-labelledby="passport-issuance-title">
            <Image
              src="/images/guest-home/passport-open-empty.png"
              alt="펼쳐진 Fan Passport"
              width={1536}
              height={1024}
              priority
            />
            <div className={styles.identity}>
              <h2 id="passport-issuance-title">{issuance.celebrity.name} 팬 Passport 발급 완료</h2>
              <p>팬 인증이 완료되어 첫 Stamp와 Passport가 이미 발급되었어요.</p>
              <dl>
                <div><dt>Celebrity</dt><dd>{issuance.celebrity.name}</dd></div>
                <div><dt>Tier</dt><dd>Bronze Fan</dd></div>
              </dl>
            </div>
            {stage >= 1 && (
              <div className={styles.stamp} data-stage="stamp">
                {!stampImageFailed ? (
                  <Image
                    src="/images/stamps/kara-verification-stamp.png"
                    alt={`${issuance.celebrity.name} 팬 인증 스탬프`}
                    width={720}
                    height={720}
                    onError={() => setStampImageFailed(true)}
                  />
                ) : (
                  <div className={styles.assetError} role="status">
                    팬 인증 스탬프 이미지를 불러오지 못했어요.
                  </div>
                )}
                <strong>팬 인증 스탬프 획득</strong>
                <span>{date}</span>
              </div>
            )}
          </section>

          <aside className={styles.summary} aria-live="polite">
            <div>
              <span>팬 점수</span>
              <strong><s>0</s> <b aria-label="에서">→</b> {stage >= 2 ? issuance.score.points : 0}</strong>
            </div>
            <p>팬 인증 스탬프 획득</p>
            <span className={styles.mintStatus}>{issuanceStatus(issuance)}</span>
          </aside>
        </div>

        {stage >= 3 && (
          <Link className={styles.openPassport} href={`/passports/${issuance.passport.id}` as Route}>
            <span>Passport 열기</span><ArrowRight aria-hidden="true" />
          </Link>
        )}
      </div>
    </main>
  );
}

type ScreenState =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "error" }
  | { kind: "ready"; issuance: IssuanceAggregate };

export function PassportIssuanceScreen({ passportId }: { passportId: string }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!ready) return;
    if (!authenticated) {
      setState({ kind: "auth" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing access token");
      const response = await fetch(`/api/passports/${encodeURIComponent(passportId)}/issuance?locale=ko`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("issuance unavailable");
      const body = await response.json() as { issuance?: unknown };
      setState({ kind: "ready", issuance: parseIssuanceAggregate(body.issuance) });
    } catch {
      setState({ kind: "error" });
    }
  }, [authenticated, getAccessToken, passportId, ready]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "ready") return <PassportIssuanceCeremony issuance={state.issuance} />;
  return (
    <main className={styles.screen}>
      <div className={styles.state} aria-live="polite">
        {state.kind === "loading" ? (
          <><h1>발급된 Passport 확인 중</h1><p>이미 완료된 팬 인증 결과를 안전하게 불러오고 있어요.</p></>
        ) : state.kind === "auth" ? (
          <>
            <h1>로그인이 필요해요.</h1>
            <p>내 계정에 이미 발급된 Passport를 확인하려면 로그인해 주세요.</p>
            <AuthIntentLink locale="ko" input={{ sourcePath: `/passports/${passportId}/issuance`, sourceQuery: "", actionType: "OPEN_PASSPORT", targetType: "passport", targetId: passportId }}>로그인하고 발급 결과 확인하기</AuthIntentLink>
          </>
        ) : (
          <>
            <h1>발급 결과를 불러오지 못했어요.</h1>
            <p>이 화면에서는 Passport를 새로 발급하지 않아요. 내 Passport 화면에서 상태를 다시 확인할 수 있어요.</p>
            <button type="button" onClick={() => void load()}><RotateCcw aria-hidden="true" />다시 확인</button>
            <Link href={`/passports/${passportId}` as Route}>Passport 열기<ArrowRight aria-hidden="true" /></Link>
          </>
        )}
      </div>
    </main>
  );
}
