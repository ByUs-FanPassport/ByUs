"use client";

import { Check, ChevronLeft, ChevronRight, ImageOff, Maximize2, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { membershipPlatformLabel, type MembershipPlatform } from "@/features/certification/domain/certification";
import { AdminPagination, useAdminPagination } from "./admin-pagination";
import styles from "./certification-review-workspace.module.css";

export type ReviewStatus = "pending" | "approved" | "rejected";
export type CertificationReviewSubmission = {
  id: string; missionId: string; missionTitle: string; missionTitleEn?: string;
  celebritySlug: string; creatorNameKo?: string | null; creatorNameEn?: string | null;
  appUserId: string; applicantName?: string | null; status: ReviewStatus;
  attemptNumber: number; note: string | null; revision: number; submittedAt: string;
  reviewedAt?: string | null; rejectionReason?: string | null; previousSubmissionId?: string | null;
  instructionsKo?: string | null; instructionsEn?: string | null;
  reward: { scorePoints: number; ticketAmount: number; stampCount?: 1 };
  membershipPlatform?: MembershipPlatform;
  uploads: { id: string; width: number; height: number }[];
};
type Locale = "ko" | "en";
export type ProofLoader = (submissionId: string, uploadId: string, signal: AbortSignal) => Promise<Blob>;
function applicant(item: CertificationReviewSubmission, locale: Locale) {
  return item.applicantName || `${locale === "ko" ? "회원" : "Member"} · ${item.appUserId.slice(0, 8)}`;
}
function creator(item: CertificationReviewSubmission, locale: Locale) {
  return (locale === "ko" ? item.creatorNameKo : item.creatorNameEn) || item.creatorNameKo || item.celebritySlug;
}
function date(value: string | null | undefined, locale: Locale) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
}
export function reviewStatusLabel(status: ReviewStatus, locale: Locale) {
  return locale === "ko" ? { pending: "심사 대기", rejected: "보완 요청·반려", approved: "승인 완료" }[status]
    : { pending: "Awaiting review", rejected: "More proof / rejected", approved: "Approved" }[status];
}

export function CertificationReviewWorkspace({ submissions, locale, status, busy, canWrite, loadProof, onReview }: {
  submissions: CertificationReviewSubmission[]; locale: Locale; status: ReviewStatus; busy: boolean; canWrite: boolean;
  loadProof: ProofLoader; onReview: (item: CertificationReviewSubmission, decision: "approve" | "reject", reason?: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filtered = submissions.filter(item => (!platform || (item.membershipPlatform ?? "generic") === platform)
    && (!creatorFilter || item.celebritySlug === creatorFilter)
    && [item.applicantName, item.appUserId, item.missionTitle, item.missionTitleEn, item.celebritySlug, item.creatorNameKo, item.creatorNameEn, item.id].some(value => value?.toLocaleLowerCase().includes(query)));
  const pagination = useAdminPagination(filtered, JSON.stringify([search, platform, creatorFilter, status]));
  const selected = pagination.items.find(item => item.id === selectedId) ?? pagination.items[0];
  const creators = [...new Map(submissions.map(item => [item.celebritySlug, creator(item, locale)])).entries()];
  return <section className={styles.review} aria-label={locale === "ko" ? "인증 심사 목록과 상세" : "Certification review list and details"}>
    <div className={styles.filters}>
      <label className={styles.search}><Search aria-hidden="true" /><span className={styles.srOnly}>{locale === "ko" ? "제출 검색" : "Search submissions"}</span><input value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder={locale === "ko" ? "제출자·크리에이터 검색" : "Search member or creator"} /></label>
      <label><span className={styles.srOnly}>{locale === "ko" ? "플랫폼 필터" : "Platform filter"}</span><select value={platform} disabled={busy} onChange={event => setPlatform(event.target.value)}><option value="">{locale === "ko" ? "모든 플랫폼" : "All platforms"}</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="generic">{locale === "ko" ? "일반 인증" : "Other proof"}</option></select></label>
      <label><span className={styles.srOnly}>{locale === "ko" ? "크리에이터 필터" : "Creator filter"}</span><select value={creatorFilter} disabled={busy} onChange={event => setCreatorFilter(event.target.value)}><option value="">{locale === "ko" ? "모든 크리에이터" : "All creators"}</option>{creators.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <span className={styles.count}>{locale === "ko" ? `${filtered.length}건` : `${filtered.length} submissions`}</span>
    </div>
    {!selected ? <div className={styles.empty}><ImageOff aria-hidden="true" /><h2>{submissions.length ? (locale === "ko" ? "검색 결과가 없습니다" : "No matching submissions") : (locale === "ko" ? "표시할 제출이 없습니다" : "No submissions to show")}</h2><p>{submissions.length ? (locale === "ko" ? "검색어나 필터를 바꿔 주세요." : "Try another search or filter.") : status === "pending" ? (locale === "ko" ? "팬이 인증 이미지를 제출하면 이곳에서 확인하고 심사할 수 있습니다." : "When a fan submits proof images, you can review them here.") : (locale === "ko" ? "이 상태의 심사 내역이 없습니다." : "There is no review history with this status.")}</p></div>
      : <div className={styles.workspace}>
        <div><div className={styles.list} aria-label={locale === "ko" ? "제출 목록" : "Submissions"}>
          {pagination.items.map(item => <button type="button" key={item.id} aria-pressed={selected.id === item.id} disabled={busy} onClick={() => setSelectedId(item.id)}><span className={styles.listTop}><strong>{applicant(item, locale)}</strong><span>{item.uploads.length}{locale === "ko" ? "장" : " images"}</span></span><span>{creator(item, locale)} · {item.membershipPlatform ? membershipPlatformLabel(item.membershipPlatform) : (locale === "ko" ? "일반 인증" : "Other proof")}</span><small>{date(item.submittedAt, locale)} · {locale === "ko" ? `${item.attemptNumber}차 제출` : `Attempt ${item.attemptNumber}`}</small></button>)}
        </div><AdminPagination {...pagination} locale={locale} disabled={busy} /></div>
        <ReviewDetail key={`${selected.id}:${selected.revision}`} item={selected} locale={locale} busy={busy} canWrite={canWrite} loadProof={loadProof} onReview={onReview} />
      </div>}
  </section>;
}

function ReviewDetail({ item, locale, busy, canWrite, loadProof, onReview }: {
  item: CertificationReviewSubmission; locale: Locale; busy: boolean; canWrite: boolean; loadProof: ProofLoader;
  onReview: (item: CertificationReviewSubmission, decision: "approve" | "reject", reason?: string) => Promise<void>;
}) {
  const [proofs, setProofs] = useState<{ id: string; url: string }[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [proofError, setProofError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState("");
  const zoomDialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const proofGeneration = useRef(0);
  const uploadKey = item.uploads.map(upload => upload.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++proofGeneration.current;
    const urls: string[] = [];
    const uploadIds = uploadKey ? uploadKey.split(",") : [];
    setLoading(true); setProofError(false); setProofs([]); setLoaded([]); setIndex(0);
    void Promise.all(uploadIds.map(async id => {
      const blob = await loadProof(item.id, id, controller.signal);
      if (controller.signal.aborted) return null;
      if (!blob.type.startsWith("image/")) throw new Error("Invalid proof image");
      const url = URL.createObjectURL(blob); urls.push(url); return { id, url };
    })).then(result => {
      if (controller.signal.aborted || generation !== proofGeneration.current) return;
      setProofs(result.filter((proof): proof is { id: string; url: string } => proof !== null));
    }).catch(() => {
      if (!controller.signal.aborted && generation === proofGeneration.current) setProofError(true);
    }).finally(() => {
      if (!controller.signal.aborted && generation === proofGeneration.current) setLoading(false);
    });
    return () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url); };
  }, [item.id, uploadKey, loadProof, retry]);
  const allProofsVisible = !loading && !proofError && item.uploads.length > 0 && loaded.length === item.uploads.length;
  const editable = canWrite && item.status === "pending" && !busy;
  const currentProof = proofs[index];
  const generation = proofGeneration.current;
  function markLoaded(id: string) {
    if (generation === proofGeneration.current) setLoaded(value => value.includes(id) ? value : [...value, id]);
  }
  const criteria = locale === "ko" ? ["크리에이터 계정", "제출자의 플랫폼 계정", "현재 유료 멤버십 상태", "다음 결제일 또는 유효기간"] : ["Creator account", "Applicant’s platform account", "Current paid membership", "Next billing or expiration date"];
  const instructions = locale === "ko" ? item.instructionsKo : item.instructionsEn;
  return <div className={styles.detail}>
    <header className={styles.detailHeader}><div><p>{creator(item, locale)} · {item.membershipPlatform ? membershipPlatformLabel(item.membershipPlatform) : (locale === "ko" ? "일반 인증" : "Other proof")}</p><h2>{applicant(item, locale)}</h2><span>{locale === "ko" ? "제출" : "Submitted"} {date(item.submittedAt, locale)} (KST) · {locale === "ko" ? `${item.attemptNumber}차` : `Attempt ${item.attemptNumber}`}</span></div><span className={styles.badge} data-status={item.status}>{item.status === "rejected" && item.membershipPlatform ? (locale === "ko" ? "보완 요청" : "More proof needed") : reviewStatusLabel(item.status, locale)}</span></header>
    <div className={styles.reviewBody}>
      <section className={styles.evidence} aria-label={locale === "ko" ? "제출 이미지" : "Submitted images"}>
        <div className={styles.evidenceHeading}><h3>{locale === "ko" ? "인증 이미지" : "Proof images"} <span>{item.uploads.length}{locale === "ko" ? "장" : " images"}</span></h3><button type="button" disabled={!currentProof || proofError || loading} onClick={() => zoomDialog.current?.showModal()}><Maximize2 aria-hidden="true" />{locale === "ko" ? "확대 보기" : "Enlarge"}</button></div>
        {loading ? <div className={styles.imageState} role="status">{locale === "ko" ? "이미지를 불러오는 중입니다…" : "Loading images…"}</div>
          : proofError ? <div className={styles.imageState} role="alert"><ImageOff aria-hidden="true" /><strong>{locale === "ko" ? "이미지를 불러오지 못했습니다" : "Could not display images"}</strong><p>{locale === "ko" ? "확인하지 못한 자료는 승인할 수 없습니다." : "Approval requires visible proof images."}</p><button type="button" onClick={() => setRetry(value => value + 1)}><RotateCcw aria-hidden="true" />{locale === "ko" ? "이미지 다시 불러오기" : "Retry images"}</button></div>
            : currentProof ? <div className={styles.imageStage}><img key={currentProof.url} src={currentProof.url} alt={locale === "ko" ? `인증 이미지 ${index + 1}` : `Proof image ${index + 1}`} onLoad={() => markLoaded(currentProof.id)} onError={() => { if (generation === proofGeneration.current) setProofError(true); }} /></div>
              : <div className={styles.imageState}><ImageOff aria-hidden="true" /><strong>{locale === "ko" ? "첨부된 이미지가 없습니다" : "No image attached"}</strong><p>{locale === "ko" ? "이미지 증빙이 필요합니다. 보완을 요청해 주세요." : "Image evidence is required. Request additional proof."}</p></div>}
        {!proofError && proofs.length > 0 ? <div className={styles.thumbnails}>{proofs.map((proof, proofIndex) => <button type="button" key={proof.url} aria-label={locale === "ko" ? `이미지 ${proofIndex + 1} 선택` : `Select image ${proofIndex + 1}`} aria-pressed={index === proofIndex} onClick={() => setIndex(proofIndex)}><img src={proof.url} alt={locale === "ko" ? `인증 이미지 ${proofIndex + 1} 미리보기` : `Proof thumbnail ${proofIndex + 1}`} onLoad={() => markLoaded(proof.id)} onError={() => { if (generation === proofGeneration.current) setProofError(true); }} /><span>{proofIndex + 1}</span></button>)}</div> : null}
      </section>
      <aside className={styles.context}>
        {item.membershipPlatform ? <section><h3>{locale === "ko" ? "확인할 내용" : "Review checklist"}</h3><p>{locale === "ko" ? "캡처에서 네 가지 정보를 확인해 주세요." : "Check all four details in the screenshots."}</p><ul className={styles.criteria}>{criteria.map((criterion, criterionIndex) => <li key={criterion}><span>{criterionIndex + 1}</span>{criterion}</li>)}</ul><p className={styles.helper}>{locale === "ko" ? "일반 팔로우·무료 구독은 대상이 아닙니다. 결제 수단 등 불필요한 개인정보는 가릴 수 있습니다." : "Free follows and subscriptions do not qualify. Unrelated payment details may be hidden."}</p></section> : <section><h3>{locale === "ko" ? "인증 기준" : "Requirements"}</h3><p>{instructions || (locale === "ko" ? "미션 안내에 따라 제출 자료를 확인해 주세요." : "Review the evidence against the mission instructions.")}</p></section>}
        <section><h3>{locale === "ko" ? "제출 설명" : "Applicant note"}</h3><p className={styles.note}>{item.note || (locale === "ko" ? "작성한 설명이 없습니다." : "No note provided.")}</p></section>
        <section><h3>{locale === "ko" ? "승인 보상" : "Approval reward"}</h3><p className={styles.reward}>{item.reward.stampCount ? <span>{locale === "ko" ? "멤버십 스탬프 1개" : "1 Membership Stamp"}</span> : null}{item.reward.scorePoints > 0 ? <span>{locale === "ko" ? `팬 점수 +${item.reward.scorePoints}` : `+${item.reward.scorePoints} fan score`}</span> : null}{item.reward.ticketAmount > 0 ? <span>{locale === "ko" ? `응모권 ${item.reward.ticketAmount}장` : `${item.reward.ticketAmount} tickets`}</span> : null}</p></section>
        {item.status !== "pending" ? <section><h3>{locale === "ko" ? "심사 내역" : "Review history"}</h3><p>{date(item.reviewedAt, locale)} (KST)</p>{item.rejectionReason ? <p className={styles.note}>{item.rejectionReason}</p> : null}</section> : <section className={styles.decision}><label><span>{item.membershipPlatform ? (locale === "ko" ? "보완 요청 사유" : "Reason more proof is needed") : (locale === "ko" ? "반려 사유" : "Rejection reason")}</span><select aria-label={locale === "ko" ? "자주 쓰는 사유" : "Common reason"} disabled={!editable} defaultValue="" onChange={event => { if (event.target.value) setReason(event.target.value); }}><option value="">{locale === "ko" ? "사유 선택 또는 직접 작성" : "Choose a reason or write your own"}</option>{(item.membershipPlatform ? criteria.map(value => locale === "ko" ? `${value} 정보가 보이는 이미지를 첨부해 주세요.` : `Please attach an image showing: ${value}.`) : [locale === "ko" ? "인증 기준을 확인할 수 있는 이미지를 첨부해 주세요." : "Please attach an image showing the required proof."]).map(value => <option key={value}>{value}</option>)}</select><textarea maxLength={1000} disabled={!editable} value={reason} onChange={event => setReason(event.target.value)} placeholder={locale === "ko" ? "다시 제출할 내용을 구체적으로 알려 주세요." : "Explain what the applicant needs to resubmit."} /></label><span className={styles.helper}>{locale === "ko" ? "보완 요청·반려 시 사유를 3자 이상 입력해 주세요." : "Enter a reason of at least 3 characters when requesting changes."}</span><div className={styles.actions}><button type="button" className={styles.approve} disabled={!editable || !allProofsVisible} onClick={() => confirmDialog.current?.showModal()}><Check aria-hidden="true" />{locale === "ko" ? "승인" : "Approve"}</button><button type="button" disabled={!editable || reason.trim().length < 3} onClick={() => void onReview(item, "reject", reason)}>{item.membershipPlatform ? (locale === "ko" ? "보완 요청" : "Request more proof") : (locale === "ko" ? "반려" : "Reject")}</button></div>{!allProofsVisible ? <p className={styles.helper}>{locale === "ko" ? "모든 첨부 이미지가 표시되면 승인할 수 있습니다." : "Approval is available once every attached image is displayed."}</p> : null}{!canWrite ? <p className={styles.helper}>{locale === "ko" ? "조회 권한으로 접속 중입니다." : "You have read-only access."}</p> : null}</section>}
        <details className={styles.metadata}><summary>{locale === "ko" ? "제출 상세 정보" : "Submission details"}</summary><p>{locale === "en" ? item.missionTitleEn || item.missionTitle : item.missionTitle}</p><p>{locale === "ko" ? "제출 ID" : "Submission ID"}: {item.id}</p><p>{locale === "ko" ? "회원 ID" : "Member ID"}: {item.appUserId}</p>{item.previousSubmissionId ? <p>{locale === "ko" ? "이전 제출 ID" : "Previous submission ID"}: {item.previousSubmissionId}</p> : null}</details>
      </aside>
    </div>
    <dialog ref={zoomDialog} className={styles.zoomDialog} aria-label={locale === "ko" ? "인증 이미지 확대" : "Enlarged proof image"}><div className={styles.zoomToolbar}><strong>{locale === "ko" ? "인증 이미지" : "Proof image"} {index + 1} / {proofs.length}</strong><div><button type="button" aria-label={locale === "ko" ? "이전 이미지" : "Previous image"} disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft aria-hidden="true" /></button><button type="button" aria-label={locale === "ko" ? "다음 이미지" : "Next image"} disabled={index >= proofs.length - 1} onClick={() => setIndex(value => value + 1)}><ChevronRight aria-hidden="true" /></button><button type="button" aria-label={locale === "ko" ? "확대 닫기" : "Close enlarged image"} onClick={() => zoomDialog.current?.close()}><X aria-hidden="true" /></button></div></div>{currentProof ? <img src={currentProof.url} alt={locale === "ko" ? `확대한 인증 이미지 ${index + 1}` : `Enlarged proof image ${index + 1}`} /> : null}</dialog>
    <dialog ref={confirmDialog} className={styles.confirmDialog} aria-labelledby={`approve-title-${item.id}`}><h2 id={`approve-title-${item.id}`}>{locale === "ko" ? "인증을 승인할까요?" : "Approve this submission?"}</h2><p>{applicant(item, locale)} · {creator(item, locale)}</p><p>{locale === "ko" ? "첨부 이미지와 인증 기준을 확인했다면 승인해 주세요. 승인 보상이 지급됩니다." : "Confirm that the images meet the requirements. The approval reward will be issued."}</p><div className={styles.actions}><button type="button" onClick={() => confirmDialog.current?.close()}>{locale === "ko" ? "돌아가기" : "Go back"}</button><button type="button" className={styles.approve} disabled={!editable || !allProofsVisible} onClick={() => { confirmDialog.current?.close(); void onReview(item, "approve"); }}>{locale === "ko" ? "승인 확정" : "Confirm approval"}</button></div></dialog>
  </div>;
}
