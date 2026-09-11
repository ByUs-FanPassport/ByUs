"use client";
import { usePrivy } from "@privy-io/react-auth";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./operations.module.css";

type Status = "pending" | "processing" | "sent" | "failed";
type ProviderStatus = "prepared"|"sending"|"accepted"|"unknown"|"delivered"|"failed"|"suppressed";
type Delivery = { id:string; channel:"push"|"email"|"kakao"; kind:string; status:Status; attemptCount:number; nextAttemptAt:string; destinationLabel:string; errorCode:string|null; createdAt:string; sentAt:string|null; manuallyRetryable:boolean; providerStatus?:ProviderStatus|null;providerMessageId?:string|null;providerStatusCode?:string|null };
const providerStatusLabel:Record<ProviderStatus,string>={prepared:"준비됨",sending:"전송 중",accepted:"접수 완료 / 배달 확인 중",unknown:"결과 확인 필요",delivered:"배달 완료",failed:"배달 실패",suppressed:"전송 제외"};

export function NotificationMonitor() {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const params = useSearchParams();
  const initialStatus = params.get("status");
  const [status, setStatus] = useState<Status|"">(
    initialStatus === "pending" || initialStatus === "processing" || initialStatus === "sent" || initialStatus === "failed" ? initialStatus : "",
  );
  const [data, setData] = useState<{counts:Record<Status,number>;items:Delivery[]}|null>(null);
  const [state, setState] = useState<"loading"|"ready"|"error">("loading");
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const [retryError, setRetryError] = useState("");
  const retryingIdsRef = useRef(new Set<string>());
  const retryKeysRef = useRef(new Map<string,string>());

  const load = useCallback(async () => {
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const query = status ? `?status=${status}` : "";
      const response = await fetch(`/api/admin/notification-deliveries${query}`, { headers:{authorization:`Bearer ${token}`}, cache:"no-store" });
      if (!response.ok) throw new Error("load failed");
      setData(await response.json());
      setState("ready");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }, [getAccessToken, status]);

  useEffect(() => { if (session.status === "authorized") void load(); }, [load, session.status]);

  async function retry(id:string) {
    if (retryingIdsRef.current.has(id)) return;
    retryingIdsRef.current.add(id);
    setRetryingIds((current) => new Set(current).add(id));
    setRetryError("");
    const idempotencyKey = retryKeysRef.current.get(id) ?? crypto.randomUUID();
    retryKeysRef.current.set(id, idempotencyKey);
    let postSucceeded = false;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const response = await fetch(`/api/admin/notification-deliveries/${id}/retry`, {
        method:"POST",
        headers:{ authorization:`Bearer ${token}`, "idempotency-key":idempotencyKey, "x-correlation-id":crypto.randomUUID() },
      });
      if (!response.ok) throw new Error("retry failed");
      postSucceeded = true;
      if (!(await load())) throw new Error("refresh failed");
      retryKeysRef.current.delete(id);
    } catch {
      setRetryError(postSucceeded
        ? "재시도 요청은 접수됐지만 최신 상태를 불러오지 못했습니다."
        : "알림 전송을 재시도하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      retryingIdsRef.current.delete(id);
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale="ko"/>;
  return <AdminOperationsShell locale="ko" adminRole={session.admin.role}>
    <header className={styles.pageHeading}><p>전송 운영</p><h1>알림 전송</h1><span>Push, Email, Kakao 상태를 수신자 정보 없이 확인하고 최종 실패만 재시도합니다.</span></header>
    {data && <div className={styles.summaryGrid}>{(["pending","processing","sent","failed"] as const).map((deliveryStatus) => <button key={deliveryStatus} type="button" aria-pressed={status === deliveryStatus} onClick={() => setStatus(deliveryStatus)}><span>{deliveryStatus}</span><strong>{data.counts[deliveryStatus]}</strong></button>)}</div>}
    <div className={styles.filterBar}><label><span>상태</span><select value={status} onChange={(event) => setStatus(event.target.value as Status|"")}><option value="">전체</option><option>pending</option><option>processing</option><option>sent</option><option>failed</option></select></label></div>
    {retryingIds.size > 0 && <p role="status">알림 전송을 재시도하는 중입니다.</p>}
    {retryError && <p role="alert">{retryError}</p>}
    {state === "loading" && <p role="status">알림 전송을 불러오는 중입니다.</p>}
    {state === "error" && <button type="button" onClick={() => void load()}>다시 시도</button>}
    {state === "ready" && data?.items.length === 0 && <p>조건에 맞는 전송이 없습니다.</p>}
    {state === "ready" && data && data.items.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th>상태</th><th>제공사 상태</th><th>채널</th><th>알림</th><th>수신 대상</th><th>시도</th><th>오류</th><th>작업</th></tr></thead><tbody>{data.items.map((delivery) => <tr key={delivery.id}><td>{delivery.status}</td><td>{delivery.providerStatus ? providerStatusLabel[delivery.providerStatus] : "—"}{delivery.providerStatusCode ? ` · ${delivery.providerStatusCode}` : ""}</td><td>{delivery.channel}</td><td>{delivery.kind}</td><td>{delivery.destinationLabel}</td><td>{delivery.attemptCount}</td><td>{delivery.errorCode ?? "—"}</td><td><button type="button" disabled={delivery.channel==="kakao" || !delivery.manuallyRetryable || session.admin.role === "viewer" || retryingIds.has(delivery.id)} onClick={() => void retry(delivery.id)} aria-label={`재시도 ${delivery.id}`}><RefreshCw aria-hidden="true"/>{retryingIds.has(delivery.id) ? "재시도 중" : "재시도"}</button></td></tr>)}</tbody></table></div>}
  </AdminOperationsShell>;
}
