"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__certification__ui__certification-detail-screen";
import { translate } from "@/i18n/messages";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, CheckCircle2, Crown, ExternalLink, ImagePlus, Ticket, X } from "lucide-react";
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
  membershipPlatformLabel,
  submissionSchema,
  type CertificationLocale,
  type ManualCertification,
  type CertificationSubmission,
} from "../domain/certification";
import styles from "./certification.module.css";

type OwnerProof = { id: string; url: string };
type SelectedProof = { id: number; file: File; url: string };
type Auth = ReturnType<typeof usePrivy>;
const allowedProofTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxProofBytes = 3 * 1024 * 1024;
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
  locale: AppLocale;
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
  locale: AppLocale;
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
  const [files, setFiles] = useState<SelectedProof[]>([]);
  const [fileError, setFileError] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenProvider = useRef(getAccessToken);
  const proofUrls = useRef<string[]>([]);
  const selectedProofUrls = useRef<string[]>([]);
  const nextSelectedProofId = useRef(0);
  const submitInFlight = useRef<Promise<void> | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);
  const passports = useOwnedFanResource(
    submission?.status === "approved" ? `/api/passports?locale=${toContentLocale(locale)}&tierStages=1` : null,
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
    void fetch(`/api/certifications/${id}?locale=${toContentLocale(locale)}`, { signal: controller.signal })
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
          `/api/me/celebrities/${encodeURIComponent(slug)}/certifications?locale=${toContentLocale(locale)}`,
          { headers, cache: "no-store", signal: controller.signal },
        );
        if (!historyResponse.ok) throw new Error();
        const history = z.array(historyItemSchema).parse((await historyResponse.json()).certifications);
        const attempts = history.filter((item) => item.kind === "manual" && item.missionId === id);
        const latest = attempts[0] ?? null;
        const targetId = selectedSubmissionId ?? latest?.id;
        if (!targetId || (selectedSubmissionId && !attempts.some((item) => item.id === selectedSubmissionId))) return;
        const response = await fetch(
          `/api/certification-submissions/${targetId}?locale=${toContentLocale(locale)}`,
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
        if (!controller.signal.aborted) setMessage(locale === "ko" ? "제출 내역을 불러오지 못했어요." : translate(locale, localizedMessages.mac2d72afdaf6, "Could not load your submission."));
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

  useEffect(() => () => {
    for (const url of selectedProofUrls.current) URL.revokeObjectURL(url);
    selectedProofUrls.current = [];
  }, []);

  function selectFiles(nextFiles: File[]) {
    // Cancelling the native picker must preserve both the selection and feedback.
    if (!nextFiles.length) return;
    const selected = [...files];
    const errors: string[] = [];
    for (const file of nextFiles) {
      if (selected.some((item) => item.file.name === file.name && item.file.size === file.size
        && item.file.type === file.type && item.file.lastModified === file.lastModified)) continue;
      const reason = !allowedProofTypes.has(file.type)
        ? (locale === "ko" ? "JPG, PNG, WEBP 이미지 파일만 첨부할 수 있어요." : translate(locale, localizedMessages.mf9694cc473a8, "Use a JPG, PNG, or WEBP image."))
        : file.size <= 0
          ? (locale === "ko" ? "내용이 없는 이미지 파일은 첨부할 수 없어요." : translate(locale, localizedMessages.mab6bb324c8c2, "This image file is empty."))
          : file.size > maxProofBytes
            ? (locale === "ko" ? "3MB를 초과했어요. 용량을 줄여 다시 첨부해 주세요." : translate(locale, localizedMessages.m7934d577ac1a, "This image exceeds 3MB. Reduce its size and add it again."))
            : selected.length >= 3
              ? (locale === "ko" ? "이미지는 최대 3장까지 첨부할 수 있어요. 기존 이미지를 삭제한 뒤 추가해 주세요." : translate(locale, localizedMessages.m678809bebf4b, "You can attach up to 3 images. Remove an image before adding another."))
              : "";
      if (reason) {
        errors.push(locale === "ko" ? `${file.name} 첨부 안 됨: ${reason}` : translate(locale, localizedMessages.mbcb1c6488a1d, "{0} was not added: {1}", [file.name, reason]));
        continue;
      }
      selected.push({ id: nextSelectedProofId.current++, file, url: URL.createObjectURL(file) });
    }
    selectedProofUrls.current = selected.map(({ url }) => url);
    setFiles(selected);
    setFileError(errors.join("\n"));
  }

  function removeFile(id: number) {
    setFiles((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      const next = current.filter((item) => item.id !== id);
      selectedProofUrls.current = next.map(({ url }) => url);
      return next;
    });
    setFileError("");
  }

  function submit() {
    if (submitInFlight.current) return submitInFlight.current;
    const operation = (async () => {
      if (!authenticated) {
        await login();
        return;
      }
      if (!files.length || files.length > 3 || !mission) {
        if (!files.length) setFileError(locale === "ko" ? "인증 이미지를 1장 이상 첨부해 주세요." : translate(locale, localizedMessages.m23175a41c170, "Attach at least 1 proof image."));
        return;
      }
      const controller = new AbortController();
      const createdSubmissionProofUrls: string[] = [];
      mutationAbort.current = controller;
      setBusy(true);
      setMessage("");
      try {
        const token = await tokenProvider.current();
        if (!token || controller.signal.aborted) throw new Error();
        const uploadIds: string[] = [];
        for (const selected of files) {
          const form = new FormData();
          form.set("file", selected.file);
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
        const detail = await fetch(`/api/certification-submissions/${result.submission.id}?locale=${toContentLocale(locale)}`, {
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
        for (const url of selectedProofUrls.current) URL.revokeObjectURL(url);
        selectedProofUrls.current = [];
        setFiles([]);
        setFileError("");
        setNote("");
        setMessage(locale === "ko" ? "인증 자료를 제출했어요." : translate(locale, localizedMessages.me1a5ed911d33, "Your proof was submitted."));
      } catch {
        for (const url of createdSubmissionProofUrls) URL.revokeObjectURL(url);
        if (!controller.signal.aborted) setMessage(locale === "ko" ? "제출하지 못했어요. 이미지와 인증 상태를 확인해 주세요." : translate(locale, localizedMessages.ma2768e084eb5, "Submission failed. Check your images and certification status."));
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
  const membershipPlatform = mission?.membershipPlatform ?? submission?.membershipPlatform;
  const isMembership = Boolean(membershipPlatform);
  const statusLabel = submission ? ({
    pending: locale === "ko" ? "검토 중" : translate(locale, localizedMessages.m83ae55962a3d, "Under review"),
    approved: locale === "ko" ? "승인" : translate(locale, localizedMessages.m3c4c0ffa7511, "Approved"),
    rejected: isMembership
      ? locale === "ko" ? "보완 필요" : translate(locale, localizedMessages.m1d2634778436, "More proof needed")
      : locale === "ko" ? "반려" : translate(locale, localizedMessages.mcd241e0b843d, "Rejected"),
  } as const)[submission.status] : null;

  return (
    <FanAppFrame locale={locale} mainId="certification-detail">
      <FanContentContainer as="main" id="certification-detail" tabIndex={-1} className={styles.detail}>
        <Link className={styles.back} href={`/c/${slug}/certifications?locale=${locale}&tab=history`}>
          <ArrowLeft aria-hidden="true" />{locale === "ko" ? "내 인증 내역" : translate(locale, localizedMessages.m445dc29b1f60, "My verification history")}
        </Link>
        {title && reward ? (
          <>
            <header className={styles.hero}>
              <span>{mission?.category ?? (locale === "ko" ? "내 인증 기록" : translate(locale, localizedMessages.mde69a148dc22, "My certification"))}</span>
              <h1>{title}</h1>
              {mission?.description ? <p>{mission.description}</p> : null}
              {reward.scorePoints > 0 || reward.ticketAmount > 0 || reward.stampCount ? <div className={styles.rewardCard}>
                {reward.scorePoints > 0 ? <strong>+{reward.scorePoints} {locale === "ko" ? "팬 점수" : translate(locale, localizedMessages.mf5f0dc89bb4b, "fan score")}</strong> : null}
                {reward.stampCount ? <span><Crown aria-hidden="true" />{locale === "ko" ? "멤버십 Stamp 1개" : translate(locale, localizedMessages.maecca8f592dc, "1 Membership Stamp")}</span> : null}
                {reward.ticketAmount > 0 ? <span><Ticket aria-hidden="true" />+{reward.ticketAmount} {locale === "ko" ? "응모권" : translate(locale, localizedMessages.m93ab20a72717, "tickets")}</span> : null}
              </div> : null}
            </header>
            {mission ? <section className={styles.instructions}>
              <h2>{locale === "ko" ? "인증 방법" : translate(locale, localizedMessages.ma8f4567f52a9, "How to verify")}</h2>
              {membershipPlatform ? <MembershipEligibility locale={locale} platform={membershipPlatform} creatorAccountUrl={mission.creatorAccountUrl} /> : null}
              <p>{mission.instructions}</p>
            </section> : null}
            {submission ? (
              <section className={styles.submissionDetail} aria-labelledby="submission-detail-heading">
                <div className={styles.submissionDetailHeading}>
                  <h2 id="submission-detail-heading">{locale === "ko" ? "제출 내역" : translate(locale, localizedMessages.m0cd04178d6cc, "Submission")}</h2>
                  <span className={styles.status} data-status={submission.status}>{statusLabel}</span>
                </div>
                <dl>
                  <div><dt>{locale === "ko" ? "차수" : translate(locale, localizedMessages.m74ddf68f4e4c, "Attempt")}</dt><dd>#{submission.attemptNumber}</dd></div>
                  <div><dt>{locale === "ko" ? "제출일" : translate(locale, localizedMessages.ma1fa442ba138, "Submitted")}</dt><dd>{new Intl.DateTimeFormat(locale,{ calendar: "gregory",dateStyle:"medium",timeStyle:"short"}).format(new Date(submission.submittedAt))}</dd></div>
                  {submission.reviewedAt ? <div><dt>{locale === "ko" ? "검토일" : translate(locale, localizedMessages.m9551f5f3614e, "Reviewed")}</dt><dd>{new Intl.DateTimeFormat(locale,{ calendar: "gregory",dateStyle:"medium",timeStyle:"short"}).format(new Date(submission.reviewedAt))}</dd></div> : null}
                </dl>
                {submission.note ? <div className={styles.submissionCopy}><strong>{locale === "ko" ? "제출 설명" : translate(locale, localizedMessages.m99ce56222988, "Note")}</strong><p>{submission.note}</p></div> : null}
                {submission.rejectionReason ? <div className={styles.rejection}><strong>{isMembership ? (locale === "ko" ? "보완 요청 사유" : translate(locale, localizedMessages.mc8b6a657c5c6, "Reason more proof is needed")) : (locale === "ko" ? "반려 사유" : translate(locale, localizedMessages.maa09e04e9ec4, "Reason"))}</strong>{submission.rejectionReason}</div> : null}
                {proofs.length ? <div className={styles.proofs} aria-label={locale === "ko" ? "제출 이미지" : translate(locale, localizedMessages.m21bd68eff662, "Submitted images")}>{proofs.map((proof,index)=><img key={proof.id} src={proof.url} alt={locale === "ko" ? `제출 이미지 ${index+1}` : translate(locale, localizedMessages.m679cf1288af4, "Submitted image {0}", [index+1])} />)}</div> : null}
              </section>
            ) : null}
            {submission?.status === "pending" ? <section className={styles.submissionState} role="status"><CheckCircle2 /><h2>{locale === "ko" ? "검토 중이에요" : translate(locale, localizedMessages.m0925ffbca0e7, "Under review")}</h2><p>{locale === "ko" ? "관리자가 인증 자료를 확인하고 있어요." : translate(locale, localizedMessages.m546aeb7f9844, "An administrator is reviewing your proof.")}</p></section>
              : submission?.status === "approved" ? <ApprovedNextStep locale={locale} slug={slug} passportState={passports.state}/>
                : submission?.status === "rejected" && !currentRejected ? <section className={styles.submissionState} role="status"><CheckCircle2 /><h2>{locale === "ko" ? "이후 제출 내역이 있어요" : translate(locale, localizedMessages.mc0dfd548ea18, "A newer submission exists")}</h2></section>
                  : null}
            {canOpenForm ? (
              <section className={styles.formArea} aria-labelledby="proof-heading">
                <h2 id="proof-heading">{currentRejected ? (isMembership ? (locale === "ko" ? "보완 자료 제출하기" : translate(locale, localizedMessages.m3254b2dced07, "Submit additional proof")) : (locale === "ko" ? "자료를 보완해 다시 제출해 주세요" : translate(locale, localizedMessages.m12b1b7d6e4ec, "Update and resubmit your proof"))) : (locale === "ko" ? "인증 자료 제출" : translate(locale, localizedMessages.mdd94a640047d, "Submit proof"))}</h2>
                <div className={styles.requiredFieldHeading}>
                  <strong>{locale === "ko" ? "인증 이미지 (필수)" : translate(locale, localizedMessages.m6a4a246fca0d, "Proof images (required)")}</strong>
                  <span>{locale === "ko" ? "1~3장 · JPG, PNG, WEBP · 장당 3MB 이하" : translate(locale, localizedMessages.m29982f172359, "1–3 images · JPG, PNG, WEBP · 3MB each")}</span>
                </div>
                <label className={styles.filePicker}><ImagePlus aria-hidden="true" /><span>{files.length ? (locale === "ko" ? "이미지 추가" : translate(locale, localizedMessages.m80d6b57a6027, "Add images")) : (locale === "ko" ? "이미지 선택" : translate(locale, localizedMessages.m0e581051e6f0, "Choose images"))}</span><input aria-describedby="proof-file-hint proof-file-count proof-file-error" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={busy} onChange={(event)=>{selectFiles([...(event.currentTarget.files??[])]);event.currentTarget.value="";}}/></label>
                <p className={styles.fileHint} id="proof-file-hint">{isMembership
                  ? locale === "ko" ? "크리에이터와 내 계정, 유료 멤버십 상태, 다음 결제일 또는 유효기간이 보이는 캡처를 첨부해 주세요." : translate(locale, localizedMessages.mde29830c7134, "Attach screenshots showing the creator, your account, paid membership status, and next billing or expiration date.")
                  : locale === "ko" ? "위 인증 안내에 맞는 이미지 자료를 1장 이상 첨부해 주세요." : translate(locale, localizedMessages.md554dcc9df45, "Attach at least one image that meets the proof requirements above.")}</p>
                <p className={styles.fileHint} id="proof-file-count" role="status">{locale === "ko" ? `${files.length}/3장 첨부됨` : translate(locale, localizedMessages.m0c243d4ca824, "{0}/3 images attached", [files.length])}</p>
                <p className={styles.fileError} id="proof-file-error" role="alert">{fileError}</p>
                <ul className={styles.fileList}>{files.map((selected,index)=><li key={selected.id}><img src={selected.url} alt={locale === "ko" ? `선택한 이미지 ${index+1}` : translate(locale, localizedMessages.md6e6f3167727, "Selected image {0}", [index+1])} /><span><strong>{selected.file.name}</strong><small>{(selected.file.size/1024/1024).toFixed(1)}MB</small></span><button type="button" disabled={busy} aria-label={`${selected.file.name} ${locale === "ko" ? "삭제" : translate(locale, localizedMessages.m468e187af951, "remove")}`} onClick={()=>removeFile(selected.id)}><X /></button></li>)}</ul>
                <label className={styles.note}><span>{locale === "ko" ? "설명 (선택)" : translate(locale, localizedMessages.m8193cbb22521, "Note (optional)")}</span><textarea maxLength={1000} disabled={busy} value={note} onChange={(event)=>setNote(event.target.value)}/></label>
                <button className={fanActionClassName("primary",{fullWidth:true})} type="button" disabled={busy||mission?.status!=="available"||!files.length||!ready} onClick={()=>void submit()}>{busy?(locale === "ko" ? "제출 중…" : translate(locale, localizedMessages.md94e82e31431, "Submitting…")):!authenticated?(locale === "ko" ? "로그인하고 제출하기" : translate(locale, localizedMessages.m7cb28315fd68, "Sign in to submit")):currentRejected&&isMembership?(locale === "ko" ? "보완 자료 제출하기" : translate(locale, localizedMessages.m3254b2dced07, "Submit additional proof")):(locale === "ko" ? "인증 자료 제출하기" : translate(locale, localizedMessages.ma2300aa2d477, "Submit proof"))}</button>
              </section>
            ) : null}
          </>
        ) : missionSettled && ownerHistorySettled ? <p className={styles.state}>{locale === "ko" ? "인증 정보를 불러오지 못했어요." : translate(locale, localizedMessages.ma08d5ccd2b0e, "Could not load certification.")}</p> : <p className={styles.state}>{locale === "ko" ? "제출 내역을 불러오는 중이에요." : translate(locale, localizedMessages.me8da76ea6569, "Loading submission.")}</p>}
        <p className={styles.message} role="status">{message}</p>
      </FanContentContainer>
    </FanAppFrame>
  );
}

function MembershipEligibility({
  locale,
  platform,
  creatorAccountUrl,
}: {
  locale: AppLocale;
  platform: NonNullable<ManualCertification["membershipPlatform"]>;
  creatorAccountUrl?: string;
}) {
  const platformName = membershipPlatformLabel(platform);
  return <div className={styles.membershipGuide}>
    <strong>{locale === "ko" ? `${platformName} 유료 멤버십 회원만 참여할 수 있어요` : translate(locale, localizedMessages.m41c629238dee, "For paid {0} members only", [platformName])}</strong>
    <p>{locale === "ko" ? "일반 팔로우나 무료 채널 구독은 인증 대상이 아니에요." : translate(locale, localizedMessages.m5e26ab793252, "Following an account or subscribing to a free channel does not qualify.")}</p>
    <p>{locale === "ko" ? "캡처에서 아래 네 가지 정보를 확인할 수 있어야 해요." : translate(locale, localizedMessages.m20e6e5bc2986, "Your screenshots must show these four details.")}</p>
    <ul>
      <li>{locale === "ko" ? "크리에이터 계정" : translate(locale, localizedMessages.m54b3ffb43b13, "Creator account")}</li>
      <li>{locale === "ko" ? `내 ${platformName} 계정` : translate(locale, localizedMessages.m359ad0aecd65, "Your {0} account", [platformName])}</li>
      <li>{locale === "ko" ? "현재 유료 멤버십 상태" : translate(locale, localizedMessages.mdfb94cda549a, "Current paid membership status")}</li>
      <li>{locale === "ko" ? "다음 결제일 또는 유효기간" : translate(locale, localizedMessages.mae77ee42ee74, "Next billing date or expiration date")}</li>
    </ul>
    <p>{locale === "ko" ? "화면이 나뉘어 있다면 이미지를 최대 3장까지 제출할 수 있어요. 멤버십 시작일이나 가입 기간은 선택 사항이며, 결제 수단과 인증에 필요하지 않은 개인정보는 가려도 됩니다." : translate(locale, localizedMessages.mfd76e3ff9687, "If the details appear on separate screens, you may submit up to 3 images. Start date or membership tenure is optional, and you may hide payment details and unrelated personal information.")}</p>
    <p>{locale === "ko" ? "이 크리에이터의 같은 플랫폼 멤버십은 최초 승인 시 한 번만 보상을 받아요." : translate(locale, localizedMessages.mc426e9a805f9, "You can receive this creator and platform reward once, when your first submission is approved.")}</p>
    {creatorAccountUrl ? <a href={creatorAccountUrl} target="_blank" rel="noopener noreferrer">{locale === "ko" ? "크리에이터 계정 확인" : translate(locale, localizedMessages.mfdde0933d348, "Open creator account")}<ExternalLink aria-hidden="true" /></a> : null}
  </div>;
}

function ApprovedNextStep({
  locale,
  slug,
  passportState,
}: {
  locale: AppLocale;
  slug: string;
  passportState: PassportResourceState;
}) {
  const ownedPassport = passportState.status === "ready"
    ? passportState.data.find((passport) => passport.celebrity.slug === slug) ?? null
    : null;
  const href = ownedPassport
    ? `/passports/${ownedPassport.id}?locale=${locale}`
    : passportState.status === "ready"
      ? `${creatorHomeHref(slug)}?tab=certifications&locale=${locale}#celebrity-content`
      : `/my?locale=${locale}`;
  const body = ownedPassport
    ? (locale === "ko" ? "발급된 내 패스포트를 다시 열어볼 수 있어요." : translate(locale, localizedMessages.mb654a58461c8, "You can reopen your issued Passport."))
    : passportState.status === "ready"
      ? (locale === "ko" ? "이번 인증 승인과 패스포트 발급은 별개예요. 팬 인증에서 발급 과정을 확인하세요." : translate(locale, localizedMessages.m1735acae1ea7, "This approval does not issue a Passport. Check fan verification to start issuance."))
      : passportState.status === "loading"
        ? (locale === "ko" ? "패스포트 보유 여부를 확인하는 중이에요. MY에서 내 활동을 먼저 확인할 수 있어요." : translate(locale, localizedMessages.mb6f77e3729e8, "Checking Passport ownership. You can review your activity in MY in the meantime."))
        : (locale === "ko" ? "패스포트 보유 여부를 확인하지 못했어요. MY에서 내 활동을 확인하세요." : translate(locale, localizedMessages.mca20a88717bf, "We couldn’t confirm Passport ownership. Check your activity in MY."));
  const action = ownedPassport
    ? (locale === "ko" ? "내 패스포트 보기" : translate(locale, localizedMessages.m3ca4b4bf32e8, "Open my Passport"))
    : passportState.status === "ready"
      ? (locale === "ko" ? "팬 인증 확인하기" : translate(locale, localizedMessages.m4e5359ae504c, "Check fan verification"))
      : (locale === "ko" ? "MY로 이동" : translate(locale, localizedMessages.m94e2ec6ddac7, "Go to MY"));

  return <section className={`${styles.submissionState} ${styles.approvedNext}`} role="status">
    <CheckCircle2 aria-hidden="true" />
    <h2>{locale === "ko" ? "인증이 승인됐어요" : translate(locale, localizedMessages.m180f58226684, "Certification approved")}</h2>
    <p>{body}</p>
    <Link className={fanActionClassName(ownedPassport ? "passport" : "neutral")} href={href as Route}>
      {action}<ArrowRight aria-hidden="true" />
    </Link>
  </section>;
}
