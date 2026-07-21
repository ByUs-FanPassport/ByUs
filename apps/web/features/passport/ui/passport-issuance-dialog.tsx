"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { IssuanceAggregate } from "../domain/issuance-aggregate";
import styles from "./passport-issuance-dialog.module.css";

interface PassportIssuanceDialogProps { issuance: IssuanceAggregate }

function issuanceStatus(issuance: IssuanceAggregate): string {
  const statuses = [issuance.passport.mintStatus, issuance.firstStamp.mintStatus];
  if (statuses.every((status) => status === "minted")) return "디지털 발급 완료";
  if (statuses.some((status) => status === "retryable" || status === "permanent_failure")) {
    return "발급 상태 확인 중";
  }
  if (statuses.some((status) => status === "processing")) return "디지털 발급 확인 중";
  return "디지털 발급 준비 중";
}

export function PassportIssuanceDialog({ issuance }: PassportIssuanceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState(0);
  const [stampImageFailed, setStampImageFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.showModal === "function") {
      if (dialog.open) dialog.close();
      dialog.showModal();
    }
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
    };
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
    <dialog
      ref={dialogRef}
      open
      className={styles.dialog}
      aria-labelledby="passport-issuance-title"
      onCancel={(event) => {
        event.preventDefault();
        setStage(3);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setStage(3);
        }
      }}
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
              <h2 id="passport-issuance-title">{issuance.celebrity.name} 팬 Passport 발급</h2>
              <p>첫 팬 인증 기록이 Passport에 저장되었어요.</p>
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
    </dialog>
  );
}
