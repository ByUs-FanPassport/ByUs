import Link from "next/link";

import { FanContentContainer } from "@/components/fan-shell/fan-content-container";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FanLanguageSwitch } from "@/components/fan-shell/fan-language-switch";
import { FocusFlowHeader } from "@/components/fan-shell/focus-flow-header";
import { actionDefinitions, officialAddresses, onchainConfig } from "@/server/onchain/public-config";
import type { PublicOnchainAction, PublicOnchainResult } from "@/server/onchain/public-types";
import styles from "./onchain-public-page.module.css";

const copy = {
  ko: {
    eyebrow: "PUBLIC ONCHAIN RECORDS",
    title: "ByUs 온체인 기록",
    intro: "서비스의 팬 행동을 GIWA Sepolia 테스트넷에 기록합니다. 아래 실적은 QA 지갑과 과거 이관을 제외한 확정 기록입니다.",
    testnet: "GIWA Sepolia 테스트넷",
    testnetDetail: "공개 지표는 ActionHub 배포 이후의 선언된 블록 범위를 집계합니다. 이전 Passport·Stamp 활동은 포함하지 않습니다.",
    available: "최종 확정 블록 기준",
    unavailable: "현재 온체인 스냅샷을 불러올 수 없습니다. 수치를 0으로 표시하지 않습니다.",
    aggregateUnavailable: "여러 ActionHub에서 같은 원본 행동이 확인되어 운영 지표를 표시하지 않습니다. 검증된 원장 근거는 아래에 그대로 표시합니다.",
    download: "전체 JSON 다운로드",
    metricsTitle: "현재 유효한 기록",
    metricsDescription: "현재 지표는 명시된 QA 지갑과 역사 이관 기록을 제외합니다. 정정된 행동은 원래 민팅 수를 유지하며 다시 민팅한 것으로 세지 않습니다.",
    metricWallets: "활성 지갑",
    metricActions: "현재 유효 행동",
    metricCredentials: "실제 NFT 원본 민팅",
    metricPassports: "Passport 자격 증명",
    metricLifecycle: "전체 수명주기 트랜잭션",
    currentScope: "현재 운영 범위",
    lifecycleScope: "QA·역사·정정·무효화를 포함한 원장 전체",
    actionsTitle: "행동 정의와 공개 상태",
    actionsDescription: "회원가입 수, 전체 댓글 수, 구매 인증은 현재 이 원장에 기록되지 않습니다. 값이 없는 항목은 0건이 아니라 미기록 상태입니다.",
    code: "코드",
    action: "행동",
    definition: "정의",
    count: "현재 유효 기록",
    rollout: "공개 상태",
    unconfirmed: "팬 기록 미확인",
    qaOnly: "QA 기록만 확인",
    active: (count: number) => `현재 유효 기록 ${count.toLocaleString("ko-KR")}건`,
    missingContract: "운영 발급 계약 미설정",
    statusAsOf: "확정된 온체인 원장을 기준으로 표시합니다. 실제 팬 기록이 확인되면 상태가 바뀝니다.",
    evidenceTitle: "원장 근거",
    evidenceDescription: "최근 20개 항목만 화면에 표시합니다. 전체 원장은 JSON에서 확인할 수 있습니다.",
    shown: (shown: number, total: number) => `${total.toLocaleString("ko-KR")}개 중 ${shown.toLocaleString("ko-KR")}개 표시`,
    noEvidence: "표시할 원장 항목이 없습니다. 이는 행동이 0건이라는 뜻이 아닙니다.",
    qa: "QA",
    history: "역사 이관",
    current: "현재 유효",
    invalidated: "무효화",
    excluded: "현재 집계 제외",
    wallet: "지갑",
    creator: "크리에이터",
    campaign: "캠페인",
    occurredDay: "발생일",
    block: "블록",
    transaction: "트랜잭션",
    attestation: "EAS 발행 로그",
    easUid: "EAS UID",
    source: "기록 ActionHub",
    credential: "NFT",
    openNew: "새 창에서 열기",
    directoryTitle: "공식 주소 디렉터리",
    directoryDescription: "ActionHub 프록시와 구현 계약을 구분해 표시합니다. Passport·Stamp는 현재 발급 계약이며, ActionHub 배포 이전 활동만 이 페이지의 행동 지표에 소급 합산하지 않습니다.",
    address: "주소",
    role: "역할",
    snapshotTitle: "스냅샷과 집계 범위",
    network: "네트워크",
    hub: "ActionHub 프록시",
    environment: "환경 ID",
    schema: "EAS 스키마 UID",
    coverage: "선언된 블록 범위",
    snapshotBlock: "최종 확정 블록",
    snapshotTime: "블록 시각",
    generatedAt: "생성 시각",
    exclusions: "제외 기준",
    exclusionsValue: (wallets: number, actions: number, historical: number) => `명시된 QA 지갑 ${wallets.toLocaleString("ko-KR")}개에서 발생한 행동 ${actions.toLocaleString("ko-KR")}건과 역사 이관 ${historical.toLocaleString("ko-KR")}건`,
    deploymentStatus: { current: "현재 기록 경로", historical: "이전 기록 경로", pending_activation: "운영 전환 대기" },
    lifecycleTitle: "수명주기 트랜잭션",
    lifecycleDescription: (total: number, qa: number, historical: number) => `전체 ${total.toLocaleString("ko-KR")}건 · QA 포함 ${qa.toLocaleString("ko-KR")}건 · 역사 이관 ${historical.toLocaleString("ko-KR")}건. 기록·정정·무효화 트랜잭션을 각각 표시합니다.`,
    lifecycleShown: (shown: number, total: number) => `${total.toLocaleString("ko-KR")}건 중 최근 ${shown.toLocaleString("ko-KR")}건 표시`,
    transactionKinds: { record: "기록", correct: "정정", invalidate: "무효화" },
    unavailableValue: "—",
  },
  en: {
    eyebrow: "PUBLIC ONCHAIN RECORDS",
    title: "ByUs onchain records",
    intro: "ByUs records fan actions from the service on the GIWA Sepolia testnet. The results below are finalized records excluding QA wallets and historical imports.",
    testnet: "GIWA Sepolia testnet",
    testnetDetail: "Public metrics cover the declared block range since the ActionHub deployment. Earlier Passport and Stamp activity is excluded.",
    available: "At the latest finalized block",
    unavailable: "The onchain snapshot is currently unavailable. Missing figures are not shown as zero.",
    aggregateUnavailable: "The same source action appears in more than one ActionHub, so operational metrics are unavailable. Verified ledger evidence remains visible below.",
    download: "Download full JSON",
    metricsTitle: "Current valid records",
    metricsDescription: "Current metrics exclude the declared QA wallet and historical imports. A corrected action retains its original mint count and is not counted as a new mint.",
    metricWallets: "Active wallets",
    metricActions: "Current valid actions",
    metricCredentials: "Original NFT mints",
    metricPassports: "Passport credentials",
    metricLifecycle: "All lifecycle transactions",
    currentScope: "Current production scope",
    lifecycleScope: "Full ledger, including QA, history, corrections, and invalidations",
    actionsTitle: "Action definitions and publication status",
    actionsDescription: "Account signups, all comments, and verified purchases are not recorded in this ledger. An unavailable value means unrecorded, not zero.",
    code: "Code",
    action: "Action",
    definition: "Definition",
    count: "Current valid records",
    rollout: "Publication status",
    unconfirmed: "Fan record not verified",
    qaOnly: "QA record only",
    active: (count: number) => `${count.toLocaleString("en-US")} current valid record${count === 1 ? "" : "s"}`,
    missingContract: "Production issuance contract not configured",
    statusAsOf: "Status reflects the finalized onchain ledger and changes when actual fan records are confirmed.",
    evidenceTitle: "Ledger evidence",
    evidenceDescription: "The page shows the first 20 recent entries. Download the JSON for the complete ledger.",
    shown: (shown: number, total: number) => `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
    noEvidence: "No ledger entries are available to display. This does not mean there were zero actions.",
    qa: "QA",
    history: "Historical",
    current: "Current",
    invalidated: "Invalidated",
    excluded: "Excluded from current count",
    wallet: "Wallet",
    creator: "Creator",
    campaign: "Campaign",
    occurredDay: "Occurrence day",
    block: "Block",
    transaction: "Transaction",
    attestation: "EAS issuance log",
    easUid: "EAS UID",
    source: "Record ActionHub",
    credential: "NFT",
    openNew: "open in a new tab",
    directoryTitle: "Official address directory",
    directoryDescription: "The ActionHub proxy and implementation contracts are listed separately. Passport and Stamp remain the current issuance contracts; only activity before the ActionHub deployment is excluded from these metrics.",
    address: "Address",
    role: "Role",
    snapshotTitle: "Snapshot and coverage",
    network: "Network",
    hub: "ActionHub proxy",
    environment: "Environment ID",
    schema: "EAS schema UID",
    coverage: "Declared block coverage",
    snapshotBlock: "Finalized block",
    snapshotTime: "Block time",
    generatedAt: "Generated at",
    exclusions: "Exclusions",
    exclusionsValue: (wallets: number, actions: number, historical: number) => `${actions.toLocaleString("en-US")} actions from ${wallets.toLocaleString("en-US")} explicitly declared QA wallet, plus ${historical.toLocaleString("en-US")} historical imports`,
    deploymentStatus: { current: "Current write route", historical: "Previous write route", pending_activation: "Pending activation" },
    lifecycleTitle: "Lifecycle transactions",
    lifecycleDescription: (total: number, qa: number, historical: number) => `${total.toLocaleString("en-US")} total · ${qa.toLocaleString("en-US")} QA · ${historical.toLocaleString("en-US")} historical. Record, correction, and invalidation transactions are listed separately.`,
    lifecycleShown: (shown: number, total: number) => `Showing the latest ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
    transactionKinds: { record: "Record", correct: "Correction", invalidate: "Invalidation" },
    unavailableValue: "—",
  },
} as const;

const roleCopy: Record<(typeof officialAddresses)[number]["role"], { ko: string; en: string }> = {
  actionHub: { ko: "ActionHub 프록시", en: "ActionHub proxy" },
  passport: { ko: "Passport 발급 계약", en: "Passport issuance contract" },
  stamp: { ko: "Stamp 발급 계약", en: "Stamp issuance contract" },
  implementation: { ko: "ActionHub 구현", en: "ActionHub implementation" },
  codec: { ko: "행동 데이터 코덱", en: "Action data codec" },
  registry: { ko: "공개 컨텍스트 레지스트리", en: "Public context registry" },
  eas: { ko: "EAS 계약", en: "EAS contract" },
  schema: { ko: "EAS 스키마 레지스트리", en: "EAS schema registry" },
  timelock: { ko: "거버넌스 타임록", en: "Governance timelock" },
  admin: { ko: "관리자 지갑", en: "Admin wallet" },
  writer: { ko: "행동 기록 지갑", en: "Action writer wallet" },
};

function explorer(path: string) {
  return `${onchainConfig.explorer}${path}`;
}

function formatTimestamp(value: string, locale: FanLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function metricValue(value: number | undefined, locale: FanLocale) {
  return value === undefined ? "—" : value.toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
}

function statusFor(code: number, actionCount: number | undefined, hasQaEvidence: boolean, locale: FanLocale) {
  const t = copy[locale];
  if (code === 11) return { label: t.missingContract, tone: "blocked" } as const;
  if (actionCount !== undefined && actionCount > 0) return { label: t.active(actionCount), tone: "active" } as const;
  if (hasQaEvidence) return { label: t.qaOnly, tone: "qa" } as const;
  return { label: t.unconfirmed, tone: "idle" } as const;
}

function occurredDayLabel(day: number, locale: FanLocale) {
  const date = new Date(day * 86_400_000);
  if (!Number.isFinite(day) || Number.isNaN(date.getTime())) return String(day);
  const formatted = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC · ${day}`;
}

function EvidenceItem({ action, locale }: { action: PublicOnchainAction; locale: FanLocale }) {
  const t = copy[locale];
  const definition = actionDefinitions.find(({ code }) => code === action.actionCode);
  const tags: string[] = [];
  if (action.qa) tags.push(t.qa);
  if (action.origin === "HISTORICAL") tags.push(t.history);
  if (action.current && action.status === "ACTIVE") tags.push(t.current);
  if (action.status === "INVALIDATED") tags.push(t.invalidated);
  else if (!action.current) tags.push(t.excluded);
  return (
    <li className={styles.evidenceItem}>
      <header className={styles.evidenceHeader}>
        <div>
          <span className={styles.actionCode}>#{action.actionCode}</span>
          <h3>{definition ? definition[locale] : action.actionId}</h3>
        </div>
        <ul className={styles.tags} aria-label={locale === "ko" ? "기록 분류" : "Record classifications"}>
          {tags.map((tag) => <li key={tag}>{tag}</li>)}
        </ul>
      </header>
      <dl className={styles.evidenceDetails}>
        <div><dt>{t.wallet}</dt><dd><a href={explorer(`/address/${action.wallet}`)} target="_blank" rel="noopener noreferrer" aria-label={`${t.wallet} ${action.wallet}, ${t.openNew}`}>{action.wallet}</a></dd></div>
        <div><dt>{t.creator}</dt><dd>{action.creatorId || "—"}</dd></div>
        <div><dt>{t.campaign}</dt><dd>{action.campaignId || "—"}</dd></div>
        <div><dt>{t.occurredDay}</dt><dd>{occurredDayLabel(action.occurredDay, locale)}</dd></div>
        <div><dt>{t.block}</dt><dd><a href={explorer(`/block/${action.blockNumber}`)} target="_blank" rel="noopener noreferrer" aria-label={`${t.block} ${action.blockNumber}, ${t.openNew}`}>{action.blockNumber}</a></dd></div>
        <div><dt>{t.easUid}</dt><dd>{action.easUid}</dd></div>
        <div><dt>{t.source}</dt><dd><a href={explorer(`/address/${action.hubAddress}`)} target="_blank" rel="noopener noreferrer" aria-label={`${action.sourceDeployment} ${action.hubAddress}, ${t.openNew}`}>{action.sourceDeployment}</a></dd></div>
      </dl>
      <div className={styles.evidenceLinks}>
        <a href={explorer(`/tx/${action.txHash}`)} target="_blank" rel="noopener noreferrer">{t.transaction}<span aria-hidden="true"> ↗</span><span className={styles.srOnly}>, {t.openNew}</span></a>
        <a href={explorer(`/tx/${action.txHash}#logs`)} target="_blank" rel="noopener noreferrer">{t.attestation}<span aria-hidden="true"> ↗</span><span className={styles.srOnly}>, {t.openNew}</span></a>
        {action.credentials.map((credential) => (
          <a key={`${credential.nftContract}-${credential.tokenId}`} href={explorer(`/token/${credential.nftContract}/instance/${credential.tokenId}`)} target="_blank" rel="noopener noreferrer">
            {t.credential} #{credential.tokenId}<span aria-hidden="true"> ↗</span><span className={styles.srOnly}>, {t.openNew}</span>
          </a>
        ))}
      </div>
    </li>
  );
}

export function OnchainPublicPage({ locale, result }: { locale: FanLocale; result: PublicOnchainResult }) {
  const t = copy[locale];
  const snapshot = result.state === "available" ? result.snapshot : undefined;
  const currentActionCount = snapshot?.business
    ? Object.values(snapshot.business.actionCounts).reduce((total, count) => total + count, 0)
    : undefined;
  const recentActions = snapshot
    ? [...snapshot.actions].sort((left, right) => {
        const leftBlock = BigInt(left.blockNumber);
        const rightBlock = BigInt(right.blockNumber);
        if (leftBlock !== rightBlock) return leftBlock > rightBlock ? -1 : 1;
        return right.revision - left.revision;
      }).slice(0, 20)
    : [];
  const recentTransactions = snapshot
    ? [...snapshot.transactions].sort((left, right) => {
        const leftBlock = BigInt(left.blockNumber);
        const rightBlock = BigInt(right.blockNumber);
        return leftBlock === rightBlock ? 0 : leftBlock > rightBlock ? -1 : 1;
      }).slice(0, 20)
    : [];
  const metricCards = [
    { label: t.metricWallets, value: snapshot?.business?.uniqueActiveWallets, scope: t.currentScope },
    { label: t.metricActions, value: currentActionCount, scope: t.currentScope },
    { label: t.metricCredentials, value: snapshot?.business?.mintedCredentials, scope: t.currentScope },
    { label: t.metricPassports, value: snapshot?.business?.passportCredentials, scope: t.currentScope },
    { label: t.metricLifecycle, value: snapshot?.raw.lifecycleTransactions, scope: t.lifecycleScope },
  ];
  const snapshotDetails = [
    [t.network, snapshot?.network ?? onchainConfig.network],
    [t.hub, snapshot ? snapshot.deployments.map((deployment) => `${deployment.label}: ${deployment.hubAddress} · ${t.deploymentStatus[deployment.writeStatus]}`).join(" | ") : onchainConfig.hubAddress],
    [t.environment, snapshot?.environmentId ?? onchainConfig.environmentId],
    [t.schema, snapshot?.schemaUid ?? onchainConfig.schemaUid],
    [t.coverage, snapshot ? `${snapshot.fromBlock}–${snapshot.blockNumber}` : t.unavailableValue],
    [t.snapshotBlock, snapshot ? `${snapshot.blockNumber} · ${snapshot.blockHash}` : t.unavailableValue],
    [t.snapshotTime, snapshot ? formatTimestamp(snapshot.blockTimestamp, locale) : t.unavailableValue],
    [t.generatedAt, snapshot ? formatTimestamp(snapshot.generatedAt, locale) : t.unavailableValue],
    [t.exclusions, snapshot ? t.exclusionsValue(snapshot.excludedQaWallets.length, snapshot.excludedQaActions, snapshot.historicalActions) : t.unavailableValue],
  ];

  return (
    <div className={styles.page} lang={locale} data-fan-surface>
      <FocusFlowHeader locale={locale} mainId="onchain-main" innerClassName={styles.headerInner}>
        <FanLanguageSwitch locale={locale} href={`/pages/onchain?locale=${locale === "ko" ? "en" : "ko"}`} ariaLabel={locale === "ko" ? "Switch to English" : "한국어로 보기"} />
      </FocusFlowHeader>
      <main id="onchain-main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="onchain-title">
          <FanContentContainer>
            <p className={styles.eyebrow}>{t.eyebrow}</p>
            <h1 id="onchain-title">{t.title}</h1>
            <p className={styles.intro}>{t.intro}</p>
            <div className={styles.networkNotice}>
              <strong>{t.testnet}</strong>
              <span>{t.testnetDetail}</span>
            </div>
            <div className={styles.heroMeta}>
              <p className={result.state === "available" ? styles.available : styles.unavailable} role={result.state === "unavailable" ? "status" : undefined}>
                {result.state === "available" ? `${t.available} · #${snapshot?.blockNumber}` : t.unavailable}
              </p>
              <Link className={styles.download} href="/api/public/onchain" download>
                {t.download}<span aria-hidden="true"> ↓</span>
              </Link>
            </div>
          </FanContentContainer>
        </section>

        <FanContentContainer className={styles.content}>
          <section className={styles.section} aria-labelledby="metrics-title">
            <div className={styles.sectionHeading}><p>01</p><div><h2 id="metrics-title">{t.metricsTitle}</h2><p>{t.metricsDescription}</p></div></div>
            {snapshot?.businessUnavailableReason ? <p className={styles.statusNote} role="status">{t.aggregateUnavailable}</p> : null}
            <dl className={styles.metricGrid}>
              {metricCards.map((metric) => <div className={styles.metric} key={metric.label}><dt>{metric.label}</dt><dd>{metricValue(metric.value, locale)}</dd><dd className={styles.metricScope}>{metric.scope}</dd></div>)}
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="actions-title">
            <div className={styles.sectionHeading}><p>02</p><div><h2 id="actions-title">{t.actionsTitle}</h2><p>{t.actionsDescription}</p><p className={styles.statusNote}>{t.statusAsOf}</p></div></div>
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={locale === "ko" ? "행동별 집계 표" : "Action metrics table"}>
              <table className={styles.actionTable} aria-labelledby="actions-title">
                <thead><tr><th scope="col">{t.code}</th><th scope="col">{t.action}</th><th scope="col">{t.definition}</th><th scope="col">{t.count}</th><th scope="col">{t.rollout}</th></tr></thead>
                <tbody>{actionDefinitions.map((definition) => {
                  const actionCount = snapshot?.business && definition.code <= 10 ? (snapshot.business.actionCounts[definition.code] ?? 0) : undefined;
                  const hasQaEvidence = snapshot?.actions.some((action) => action.actionCode === definition.code && action.qa) ?? false;
                  const status = statusFor(definition.code, actionCount, hasQaEvidence, locale);
                  return <tr key={definition.code}><td><code>{definition.code}</code></td><th scope="row"><strong>{definition[locale]}</strong><span>{definition.name}</span></th><td>{locale === "ko" ? definition.descriptionKo : definition.descriptionEn}</td><td className={styles.countCell}>{metricValue(actionCount, locale)}</td><td><span className={styles.status} data-tone={status.tone}>{status.label}</span></td></tr>;
                })}</tbody>
              </table>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="evidence-title">
            <div className={styles.sectionHeading}><p>03</p><div><h2 id="evidence-title">{t.evidenceTitle}</h2><p>{t.evidenceDescription}</p></div></div>
            {snapshot ? <p className={styles.resultCount}>{t.shown(recentActions.length, snapshot.actions.length)}</p> : null}
            {recentActions.length > 0 ? <ol className={styles.evidenceList}>{recentActions.map((action) => <EvidenceItem key={`${action.hubAddress}-${action.actionId}-${action.revision}`} action={action} locale={locale} />)}</ol> : <p className={styles.empty}>{result.state === "available" ? t.noEvidence : t.unavailable}</p>}
            {snapshot ? (
              <div className={styles.lifecycle}>
                <h3>{t.lifecycleTitle}</h3>
                <p>{t.lifecycleDescription(snapshot.raw.lifecycleTransactions, snapshot.transactions.filter(({ qa }) => qa).length, snapshot.transactions.filter(({ origin }) => origin === "HISTORICAL").length)}</p>
                <p className={styles.resultCount}>{t.lifecycleShown(recentTransactions.length, snapshot.transactions.length)}</p>
                <ul className={styles.lifecycleList}>
                  {recentTransactions.map((transaction) => (
                    <li key={`${transaction.hubAddress}-${transaction.kind}-${transaction.txHash}`}>
                      <div><strong>{t.transactionKinds[transaction.kind]}</strong><span>{transaction.qa ? t.qa : transaction.origin === "HISTORICAL" ? t.history : t.current}</span></div>
                      <a href={explorer(`/tx/${transaction.txHash}`)} target="_blank" rel="noopener noreferrer" aria-label={`${t.transactionKinds[transaction.kind]} ${transaction.txHash}, ${t.openNew}`}>{transaction.txHash}<span aria-hidden="true"> ↗</span></a>
                      <span>#{transaction.blockNumber}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="directory-title">
            <div className={styles.sectionHeading}><p>04</p><div><h2 id="directory-title">{t.directoryTitle}</h2><p>{t.directoryDescription}</p></div></div>
            <ul className={styles.directory}>
              {officialAddresses.map((entry) => <li key={entry.address}><div><strong>{entry.name}</strong><span>{roleCopy[entry.role][locale]}</span></div><a href={explorer(`/address/${entry.address}`)} target="_blank" rel="noopener noreferrer" aria-label={`${entry.name} ${t.address}, ${t.openNew}`}>{entry.address}<span aria-hidden="true"> ↗</span></a></li>)}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="snapshot-title">
            <div className={styles.sectionHeading}><p>05</p><div><h2 id="snapshot-title">{t.snapshotTitle}</h2></div></div>
            <dl className={styles.snapshotDetails}>{snapshotDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </section>
        </FanContentContainer>
      </main>
    </div>
  );
}
