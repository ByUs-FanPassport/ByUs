"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, RotateCcw, TicketCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { FanState } from "@/components/fan-ui/fan-state";
import { fanUtilityCanvasClassName } from "@/components/fan-ui/fan-surface";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { withLocalePath } from "@/components/locale-path";
import { ownedRaffleListSchema, type OwnedRaffleList } from "../domain/raffle-result";
import { RaffleResultPanel } from "./raffle-result-panel";
import styles from "./my-raffles-screen.module.css";

const copy = {
  ko: {
    title: "응모 내역",
    description: "응모한 래플의 발표와 수령 상태를 확인하세요.",
    back: "MY로 돌아가기",
    loading: "응모 내역을 불러오는 중이에요.",
    error: "응모 내역을 불러오지 못했어요.",
    errorHelp: "잠시 후 다시 확인해 주세요. 조회 실패는 미당첨을 뜻하지 않아요.",
    retry: "다시 확인",
    empty: "아직 응모 내역이 없어요.",
    emptyHelp: "응모권을 사용하면 결과와 수령 상태가 이곳에 표시돼요.",
    browse: "래플 둘러보기",
    login: "로그인하고 응모 내역 보기",
    more: "이전 응모 내역 더 보기",
    moreError: "이전 응모 내역을 불러오지 못했어요.",
  },
  en: {
    title: "Raffle history",
    description: "Track announcements and collection status for every raffle you entered.",
    back: "Back to MY",
    loading: "Loading your raffle history.",
    error: "We couldn’t load your raffle history.",
    errorHelp: "Try again shortly. A failed request does not mean you were not selected.",
    retry: "Check again",
    empty: "No raffle entries yet",
    emptyHelp: "After you use raffle tickets, results and collection status will appear here.",
    browse: "Browse raffles",
    login: "Sign in to view raffle history",
    more: "Load earlier entries",
    moreError: "We couldn’t load earlier entries.",
  },
} as const;

const parseList = (body: unknown) => ownedRaffleListSchema.parse(body);

export function MyRafflesScreen({ locale }: { locale: FanLocale }) {
  const auth = usePrivy();
  const identityKey = `${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}`;
  return <MyRafflesOwnerScreen key={identityKey} locale={locale} auth={auth} />;
}

function MyRafflesOwnerScreen({ locale, auth }: { locale: FanLocale; auth: ReturnType<typeof usePrivy> }) {
  const t = copy[locale];
  const parse = useCallback((body: unknown) => parseList(body), []);
  const resource = useOwnedFanResource(auth.authenticated ? `/api/me/raffles?locale=${locale}` : null, parse, auth);
  const [extraPages, setExtraPages] = useState<OwnedRaffleList[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const loadRef = useRef<Promise<void> | null>(null);

  const nextCursor = resource.state.status === "ready"
    ? (extraPages.length > 0 ? extraPages[extraPages.length - 1].nextCursor : resource.state.data.nextCursor)
    : null;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || loadRef.current) return;
    const operation = (async () => {
      setLoadingMore(true);
      setMoreError(false);
      try {
        const token = await auth.getAccessToken();
        if (!token) throw new Error("Authentication required");
        const query = new URLSearchParams({ locale, cursor: nextCursor });
        const response = await fetch(`/api/me/raffles?${query.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("History unavailable");
        const page: OwnedRaffleList = parseList(await response.json());
        setExtraPages((current) => [...current, page]);
      } catch {
        setMoreError(true);
      } finally {
        setLoadingMore(false);
        loadRef.current = null;
      }
    })();
    loadRef.current = operation;
    await operation;
  }, [auth, loadingMore, locale, nextCursor]);

  const heading = (
    <header className={styles.heading}>
      <FanAction variant="text" href={withLocalePath("/my", locale)} leadingIcon={<ArrowLeft />}>{t.back}</FanAction>
      <FanHeading as="h1" variant="personal-page">{t.title}</FanHeading>
      <p>{t.description}</p>
    </header>
  );

  let content;
  if (!auth.ready) content = <FanState kind="loading" title={t.loading} />;
  else if (!auth.authenticated) {
    const returnTo = withLocalePath("/my/raffles", locale);
    const login = withLocalePath(`/login?returnTo=${encodeURIComponent(returnTo)}`, locale);
    content = <FanState kind="auth" title={t.title} actions={<FanAction variant="primary" href={login}>{t.login}</FanAction>} />;
  } else if (resource.state.status === "loading") content = <FanState kind="loading" title={t.loading} />;
  else if (resource.state.status === "error") content = <FanState kind="error" title={t.error} description={t.errorHelp} actions={<FanAction variant="neutral" onClick={() => { setExtraPages([]); resource.retry(); }} leadingIcon={<RotateCcw />}>{t.retry}</FanAction>} />;
  else {
    const items = [...resource.state.data.items, ...extraPages.flatMap((page) => page.items)];
    content = items.length === 0
      ? <FanState kind="empty" title={t.empty} description={t.emptyHelp} icon={<TicketCheck />} actions={<FanAction variant="primary" href={withLocalePath("/benefits", locale)}>{t.browse}</FanAction>} />
      : <>
          <div className={styles.list}>{items.map((item) => <RaffleResultPanel key={`${item.campaignId}:${item.benefitId}`} result={item} locale={locale} />)}</div>
          {moreError ? <p className={styles.moreError} role="alert">{t.moreError}</p> : null}
          {nextCursor ? <div className={styles.more}><FanAction variant="neutral" onClick={() => void loadMore()} disabled={loadingMore} ariaBusy={loadingMore}>{t.more}</FanAction></div> : null}
        </>;
  }

  return <FanAppFrame locale={locale} className={fanUtilityCanvasClassName} mainId="raffle-history-content" currentPath="/my/raffles">
    <FanContentContainer as="main" className={styles.main} id="raffle-history-content" tabIndex={-1}>
      {heading}
      {content}
    </FanContentContainer>
  </FanAppFrame>;
}
