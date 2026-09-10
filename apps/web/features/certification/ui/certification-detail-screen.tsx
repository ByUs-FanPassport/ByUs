"use client";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, CheckCircle2, ImagePlus, Ticket, X } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { fanActionClassName } from "@/components/fan-ui/fan-action";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { parsePassportCollectionResponse } from "../../passport/domain/passport-collection";
import {
  historyItemSchema,
  manualCertificationSchema,
  submissionSchema,
  type CertificationLocale,
  type ManualCertification,
  type CertificationSubmission,
} from "../domain/certification";
import styles from "./certification.module.css";

type OwnerProof = { id: string; url: string };
type Auth = ReturnType<typeof usePrivy>;
const parseOwnerPassports = (body: unknown) => parsePassportCollectionResponse(body).passports;
type OwnerPassports = ReturnType<typeof parseOwnerPassports>;
type PassportResourceState = ReturnType<typeof useOwnedFanResource<OwnerPassports>>["state"];

export function CertificationDetailScreen({
  id,
  slug,
  locale,
  selectedSubmissionId,
}: {
  id: string;
  slug: string;
  locale: CertificationLocale;
  selectedSubmissionId?: string;
}) {
  const auth = usePrivy();
  const ownerId = auth.user?.id;
  return (
    <CertificationDetailForOwner
      key={`${auth.ready ? "ready" : "loading"}:${auth.authenticated ? "authenticated" : "guest"}:${ownerId ?? "unknown"}:${slug}:${id}:${locale}:${selectedSubmissionId ?? "latest"}`}
      id={id}
      slug={slug}
      locale={locale}
      selectedSubmissionId={selectedSubmissionId}
      auth={auth}
    />
  );
}

function CertificationDetailForOwner({
  id,
  slug,
  locale,
  selectedSubmissionId,
  auth,
}: {
  id: string;
  slug: string;
  locale: CertificationLocale;
  selectedSubmissionId?: string;
  auth: Auth;
}) {
  const { ready, authenticated, login, getAccessToken } = auth;
  const [mission, setMission] = useState<ManualCertification | null>(null);
  const [missionSettled, setMissionSettled] = useState(false);
  const [submission, setSubmission] = useState<CertificationSubmission | null>(null);
  const [latestSubmissionId, setLatestSubmissionId] = useState<string | null>(null);
  const [ownerHistorySettled, setOwnerHistorySettled] = useState(false);
  const [proofs, setProofs] = useState<OwnerProof[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenProvider = useRef(getAccessToken);
  const proofUrls = useRef<string[]>([]);
  const submitInFlight = useRef<Promise<void> | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);
  const passports = useOwnedFanResource(
    submission?.status === "approved" ? `/api/passports?locale=${locale}&tierStages=1` : null,
    parseOwnerPassports,
    auth,
  );

  useEffect(() => {
    tokenProvider.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    const controller = new AbortController();
    setMission(null);
    setMissionSettled(false);
    void fetch(`/api/certifications/${id}?locale=${locale}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return manualCertificationSchema.parse((await response.json()).certification);
      })
      .then((value) => { if (!controller.signal.aborted) setMission(value); })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setMissionSettled(true); });
    return () => controller.abort();
  }, [id, locale]);

  useEffect(() => {
    const controller = new AbortController();
    for (const url of proofUrls.current) URL.revokeObjectURL(url);
    proofUrls.current = [];
    setProofs([]);
    setSubmission(null);
    setLatestSubmissionId(null);
    setOwnerHistorySettled(false);
    if (!ready || !authenticated) {
      if (ready) setOwnerHistorySettled(true);
      return () => controller.abort();
    }
    void (async () => {
      const createdUrls: string[] = [];
      try {
        const token = await tokenProvider.current();
        if (!token || controller.signal.aborted) throw new Error();
        const headers = { authorization: `Bearer ${token}` };
        const historyResponse = await fetch(
          `/api/me/celebrities/${encodeURIComponent(slug)}/certifications?locale=${locale}`,
          { headers, cache: "no-store", signal: controller.signal },
        );
        if (!historyResponse.ok) throw new Error();
        const history = z.array(historyItemSchema).parse((await historyResponse.json()).certifications);
        const attempts = history.filter((item) => item.kind === "manual" && item.missionId === id);
        const latest = attempts[0] ?? null;
        const targetId = selectedSubmissionId ?? latest?.id;
        if (!targetId || (selectedSubmissionId && !attempts.some((item) => item.id === selectedSubmissionId))) return;
        const response = await fetch(
          `/api/certification-submissions/${targetId}?locale=${locale}`,
          { headers, cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const detail = submissionSchema.parse((await response.json()).submission);
        if (detail.missionId !== id || controller.signal.aborted) return;
        const loadedProofs = await Promise.all(detail.uploads.map(async (upload) => {
          const proof = await fetch(
            `/api/certification-submissions/${detail.id}/proofs/${upload.id}`,
            { headers, cache: "no-store", signal: controller.signal },
          );
          if (!proof.ok) throw new Error();
          const url = URL.createObjectURL(await proof.blob());
          createdUrls.push(url);
          return { id: upload.id, url };
        }));
        if (controller.signal.aborted) return;
        proofUrls.current = createdUrls;
        setLatestSubmissionId(latest?.id ?? null);
        setSubmission(detail);
        setProofs(loadedProofs);
      } catch {
        for (const url of createdUrls) URL.revokeObjectURL(url);
        if (!controller.signal.aborted) setMessage(locale === "ko" ? "제출 내역을 불러오지 못했어요." : "Could not load your submission.");
      } finally {
        if (!controller.signal.aborted) setOwnerHistorySettled(true);
      }
    })();
    return () => {
      controller.abort();
      for (const url of proofUrls.current) URL.revokeObjectURL(url);
      proofUrls.current = [];
    };
  }, [authenticated, id, locale, ready, selectedSubmissionId, slug]);

  useEffect(() => () => mutationAbort.current?.abort(), []);

  function submit() {
    if (submitInFlight.current) return submitInFlight.current;
    const operation = (async () => {
      if (!authenticated) {
        await login();
        return;
      }
      if (!files.length || files.length > 3 || !mission) return;
      const controller = new AbortController();
      const createdSubmissionProofUrls: string[] = [];
      mutationAbort.current = controller;
      setBusy(true);
      setMessage("");
      try {
        const token = await tokenProvider.current();
        if (!token || controller.signal.aborted) throw new Error();
        const uploadIds: string[] = [];
        for (const file of files) {
          const form = new FormData();
          form.set("file", file);
          const response = await fetch(`/api/certifications/${id}/uploads`, {
            method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, signal: controller.signal,
          });
          if (!response.ok) throw new Error();
          uploadIds.push((await response.json()).uploadId);
        }
        const idempotencyKey = crypto.randomUUID();
        const response = await fetch("/api/certification-submissions", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            missionId: id,
            idem: idempotencyKey,
            uploadIds,
            note: note.trim() || undefined,
            previousSubmissionId: submission?.status === "rejected" && submission.id === latestSubmissionId ? submission.id : undefined,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const result = await response.json();
        const detail = await fetch(`/api/certification-submissions/${result.submission.id}?locale=${locale}`, {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (!detail.ok) throw new Error();
        const next = submissionSchema.parse((await detail.json()).submission);
        const nextProofs = await Promise.all(next.uploads.map(async (upload) => {
          const proof = await fetch(
            `/api/certification-submissions/${next.id}/proofs/${upload.id}`,
            { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
          );
          if (!proof.ok) throw new Error();
          const url = URL.createObjectURL(await proof.blob());
          createdSubmissionProofUrls.push(url);
          return { id: upload.id, url };
        }));
        if (controller.signal.aborted) return;
        for (const url of proofUrls.current) URL.revokeObjectURL(url);
        proofUrls.current = createdSubmissionProofUrls;
        setProofs(nextProofs);
        setSubmission(next);
        setLatestSubmissionId(next.id);
        setFiles([]);
        setNote("");
        setMessage(locale === "ko" ? "인증 자료를 제출했어요." : "Your proof was submitted.");
      } catch {
        for (const url of createdSubmissionProofUrls) URL.revokeObjectURL(url);
        if (!controller.signal.aborted) setMessage(locale === "ko" ? "제출하지 못했어요. 이미지와 인증 상태를 확인해 주세요." : "Submission failed. Check your images and certification status.");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
        if (mutationAbort.current === controller) mutationAbort.current = null;
      }
    })();
    submitInFlight.current = operation;
    void operation.finally(() => { if (submitInFlight.current === operation) submitInFlight.current = null; });
    return operation;
  }

  const currentRejected = submission?.status === "rejected" && submission.id === latestSubmissionId;
  const canOpenForm = Boolean(mission) && ownerHistorySettled && (!submission || currentRejected);
  const title = mission?.title ?? submission?.title;
  const reward = mission?.reward ?? submission?.reward;
  const statusLabel = submission ? ({ pending: locale === "ko" ? "검토 중" : "Under review", approved: locale === "ko" ? "승인" : "Approved", rejected: locale === "ko" ? "반려" : "Rejected" } as const)[submission.status] : null;

  return (
    <FanAppFrame locale={locale} mainId="certification-detail">
      <FanContentContainer as="main" id="certification-detail" tabIndex={-1} className={styles.detail}>
        <Link className={styles.back} href={`/c/${slug}/certifications?locale=${locale}&tab=history`}>
          <ArrowLeft aria-hidden="true" />{locale === "ko" ? "내 인증 내역" : "My certifications"}
        </Link>
        {title && reward ? (
          <>
            <header className={styles.hero}>
              <span>{mission?.category ?? (locale === "ko" ? "내 인증 기록" : "My certification")}</span>
              <h1>{title}</h1>
              {mission?.description ? <p>{mission.description}</p> : null}
              <div className={styles.rewardCard}>
                <strong>+{reward.scorePoints} {locale === "ko" ? "팬 점수" : "fan score"}</strong>
                <span><Ticket aria-hidden="true" />+{reward.ticketAmount} {locale === "ko" ? "응모권" : "tickets"}</span>
              </div>
            </header>
            {mission ? <section className={styles.instructions}><h2>{locale === "ko" ? "인증 방법" : "How to certify"}</h2><p>{mission.instructions}</p></section> : null}
            {submission ? (
              <section className={styles.submissionDetail} aria-labelledby="submission-detail-heading">
                <div className={styles.submissionDetailHeading}>
                  <h2 id="submission-detail-heading">{locale === "ko" ? "제출 내역" : "Submission"}</h2>
                  <span className={styles.status} data-status={submission.status}>{statusLabel}</span>
                </div>
                <dl>
                  <div><dt>{locale === "ko" ? "차수" : "Attempt"}</dt><dd>#{submission.attemptNumber}</dd></div>
                  <div><dt>{locale === "ko" ? "제출일" : "Submitted"}</dt><dd>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(submission.submittedAt))}</dd></div>
                  {submission.reviewedAt ? <div><dt>{locale === "ko" ? "검토일" : "Reviewed"}</dt><dd>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(submission.reviewedAt))}</dd></div> : null}
                </dl>
                {submission.note ? <div className={styles.submissionCopy}><strong>{locale === "ko" ? "제출 설명" : "Note"}</strong><p>{submission.note}</p></div> : null}
                {submission.rejectionReason ? <div className={styles.rejection}><strong>{locale === "ko" ? "반려 사유" : "Reason"}</strong>{submission.rejectionReason}</div> : null}
                {proofs.length ? <div className={styles.proofs} aria-label={locale === "ko" ? "제출 이미지" : "Submitted images"}>{proofs.map((proof,index)=><img key={proof.id} src={proof.url} alt={locale === "ko" ? `제출 이미지 ${index+1}` : `Submitted image ${index+1}`} />)}</div> : null}
              </section>
            ) : null}
            {submission?.status === "pending" ? <section className={styles.submissionState} role="status"><CheckCircle2 /><h2>{locale === "ko" ? "검토 중이에요" : "Under review"}</h2><p>{locale === "ko" ? "관리자가 인증 자료를 확인하고 있어요." : "An administrator is reviewing your proof."}</p></section>
              : submission?.status === "approved" ? <ApprovedNextStep locale={locale} slug={slug} passportState={passports.state}/>
                : submission?.status === "rejected" && !currentRejected ? <section className={styles.submissionState} role="status"><CheckCircle2 /><h2>{locale === "ko" ? "이후 제출 내역이 있어요" : "A newer submission exists"}</h2></section>
                  : null}
            {canOpenForm ? (
              <section className={styles.formArea} aria-labelledby="proof-heading">
                <h2 id="proof-heading">{currentRejected ? (locale === "ko" ? "자료를 보완해 다시 제출해 주세요" : "Update and resubmit your proof") : (locale === "ko" ? "인증 자료 제출" : "Submit proof")}</h2>
                <label className={styles.filePicker}><ImagePlus aria-hidden="true" /><span>{locale === "ko" ? "이미지 선택 (최대 3장, 장당 3MB)" : "Choose up to 3 images, 3MB each"}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event)=>setFiles([...(event.target.files??[])].slice(0,3))}/></label>
                <ul className={styles.fileList}>{files.map((file,index)=><li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={`${file.name} ${locale==="ko"?"삭제":"remove"}`} onClick={()=>setFiles((value)=>value.filter((_,itemIndex)=>itemIndex!==index))}><X /></button></li>)}</ul>
                <label className={styles.note}><span>{locale === "ko" ? "설명 (선택)" : "Note (optional)"}</span><textarea maxLength={1000} value={note} onChange={(event)=>setNote(event.target.value)}/></label>
                <button className={fanActionClassName("primary",{fullWidth:true})} type="button" disabled={busy||mission?.status!=="available"||!files.length||!ready} onClick={()=>void submit()}>{busy?(locale==="ko"?"제출 중…":"Submitting…"):!authenticated?(locale==="ko"?"로그인하고 제출하기":"Sign in to submit"):(locale==="ko"?"인증 자료 제출하기":"Submit proof")}</button>
              </section>
            ) : null}
          </>
        ) : missionSettled && ownerHistorySettled ? <p className={styles.state}>{locale === "ko" ? "인증 정보를 불러오지 못했어요." : "Could not load certification."}</p> : <p className={styles.state}>{locale === "ko" ? "제출 내역을 불러오는 중이에요." : "Loading submission."}</p>}
        <p className={styles.message} role="status">{message}</p>
      </FanContentContainer>
    </FanAppFrame>
  );
}

function ApprovedNextStep({
  locale,
  slug,
  passportState,
}: {
  locale: CertificationLocale;
  slug: string;
  passportState: PassportResourceState;
}) {
  const ownedPassport = passportState.status === "ready"
    ? passportState.data.find((passport) => passport.celebrity.slug === slug) ?? null
    : null;
  const href = ownedPassport
    ? `/passports/${ownedPassport.id}?locale=${locale}`
    : passportState.status === "ready"
      ? `/c/${slug}?tab=certifications&locale=${locale}#celebrity-content`
      : `/my?locale=${locale}`;
  const body = ownedPassport
    ? (locale === "ko" ? "발급된 내 패스포트를 다시 열어볼 수 있어요." : "You can reopen your issued Passport.")
    : passportState.status === "ready"
      ? (locale === "ko" ? "이번 인증 승인과 패스포트 발급은 별개예요. 팬 인증에서 발급 과정을 확인하세요." : "This approval does not issue a Passport. Check fan verification to start issuance.")
      : passportState.status === "loading"
        ? (locale === "ko" ? "패스포트 보유 여부를 확인하는 중이에요. MY에서 내 활동을 먼저 확인할 수 있어요." : "Checking Passport ownership. You can review your activity in MY in the meantime.")
        : (locale === "ko" ? "패스포트 보유 여부를 확인하지 못했어요. MY에서 내 활동을 확인하세요." : "We couldn’t confirm Passport ownership. Check your activity in MY.");
  const action = ownedPassport
    ? (locale === "ko" ? "내 패스포트 보기" : "Open my Passport")
    : passportState.status === "ready"
      ? (locale === "ko" ? "팬 인증 확인하기" : "Check fan verification")
      : (locale === "ko" ? "MY로 이동" : "Go to MY");

  return <section className={`${styles.submissionState} ${styles.approvedNext}`} role="status">
    <CheckCircle2 aria-hidden="true" />
    <h2>{locale === "ko" ? "인증이 승인됐어요" : "Certification approved"}</h2>
    <p>{body}</p>
    <Link className={fanActionClassName(ownedPassport ? "passport" : "neutral")} href={href as Route}>
      {action}<ArrowRight aria-hidden="true" />
    </Link>
  </section>;
}
