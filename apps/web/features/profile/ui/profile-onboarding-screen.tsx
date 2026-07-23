"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusFlowHeader } from "@/components/fan-shell/focus-flow-header";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "../../../components/login-intent";
import styles from "./profile-onboarding-screen.module.css";

type ScreenState = "checking" | "empty" | "typing" | "valid" | "duplicate" | "prohibited" | "invalid" | "saving" | "saved" | "network";

type Copy = {
  home: string; language: string; heading: string; subtitle: string; preview: string; passport: string;
  owner: string; placeholderOwner: string; tier: string; score: string; stamps: string; issuance: string;
  issuanceValue: string; field: string; counter: (count: number) => string; rule: string; privacy: string;
  save: string; saving: string; saved: string; back: string; checking: string; empty: string; typing: string;
  valid: string; duplicate: string; prohibited: string; invalid: string; network: string; auth: string;
};

const copy: Record<"ko" | "en", Copy> = {
  ko: {
    home: "ByUs 홈", language: "언어", heading: "팬 활동에 표시할 닉네임을 정해 주세요.",
    subtitle: "Passport와 참여 기록에 사용할 공개 이름이에요.", preview: "Passport 소유자 미리보기",
    passport: "KARA FAN PASSPORT", owner: "소유자", placeholderOwner: "닉네임",
    tier: "레벨", score: "Fan Score", stamps: "Stamps", issuance: "발급",
    issuanceValue: "팬 인증 완료 후 기록", field: "닉네임", counter: (count) => `${count}/16자`,
    rule: "한글, 영문, 숫자, 공백, 밑줄, 하이픈을 사용해 2–16자로 입력해 주세요.",
    privacy: "입력한 닉네임만 공개되며 이메일과 Google 계정 정보는 표시되지 않아요.",
    save: "닉네임 저장", saving: "저장 중…", saved: "저장 완료", back: "이전으로",
    checking: "프로필을 확인하고 있어요.", empty: "사용할 닉네임을 입력해 주세요.",
    typing: "2–16자의 허용된 문자로 입력해 주세요.", valid: "사용 가능한 형식이에요. 저장할 때 중복 여부를 확인합니다.",
    duplicate: "이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.",
    prohibited: "사용할 수 없는 표현이 포함되어 있어요. 다른 이름을 입력해 주세요.",
    invalid: "닉네임의 길이 또는 문자를 확인해 주세요.",
    network: "저장하지 못했어요. 입력한 닉네임을 유지했으니 다시 시도해 주세요.",
    auth: "로그인 후 닉네임 설정을 이어갈 수 있어요.",
  },
  en: {
    home: "ByUs home", language: "Language", heading: "Choose the nickname shown in fan activities.",
    subtitle: "This public name will appear in your Passport and activity history.", preview: "Passport owner preview",
    passport: "KARA FAN PASSPORT", owner: "Owner", placeholderOwner: "Nickname",
    tier: "Level", score: "Fan Score", stamps: "Stamps", issuance: "Issued",
    issuanceValue: "Recorded after fan verification", field: "Nickname", counter: (count) => `${count}/16 characters`,
    rule: "Use 2–16 Korean or Latin letters, numbers, spaces, underscores, or hyphens.",
    privacy: "Only this nickname is public. Your email and Google account details are never shown.",
    save: "Save nickname", saving: "Saving…", saved: "Saved", back: "Go back",
    checking: "Checking your profile.", empty: "Enter the nickname you want to use.",
    typing: "Use 2–16 supported characters.", valid: "The format is valid. Availability is checked when you save.",
    duplicate: "That nickname is already in use. Please choose another.",
    prohibited: "That nickname contains a restricted expression. Please choose another.",
    invalid: "Check the nickname length and characters.",
    network: "We couldn't save it. Your nickname is still here, so you can try again.",
    auth: "Log in to continue setting your nickname.",
  },
};

const allowedNickname = /^[\p{Script=Hangul}\p{Script=Latin}\p{Number} _-]+$/u;
const draftStorageKey = "byus:profile-nickname-draft";

function graphemeCount(value: string, locale: "ko" | "en") {
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value)].length;
}

function isLocallyValid(value: string, locale: "ko" | "en") {
  const normalized = value.normalize("NFKC").trim();
  const length = graphemeCount(normalized, locale);
  return length >= 2 && length <= 16 && allowedNickname.test(normalized);
}

async function jsonBody(response: Response) {
  try { return await response.json() as { profile?: { completed?: boolean; nickname?: string | null }; error?: { code?: string; details?: { reason?: string } } }; }
  catch { return {}; }
}

export function ProfileOnboardingScreen() {
  const { replace } = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const inputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<ScreenState>("checking");
  const rawReturnTo = searchParams.get("returnTo");
  const rawIntent = searchParams.get("intent");
  const rawEntity = searchParams.get("entity");
  const rawAuthIntent = searchParams.get("authIntent");
  const rawLocale = searchParams.get("locale");
  const returnTo = useMemo(() => sanitizeReturnTo(rawReturnTo), [rawReturnTo]);
  const intent = useMemo(() => sanitizeIntent(rawIntent), [rawIntent]);
  const entity = useMemo(() => sanitizeEntity(rawEntity), [rawEntity]);
  const authIntent = useMemo(() => sanitizeAuthIntentId(rawAuthIntent), [rawAuthIntent]);
  const locale = useMemo(() => sanitizeLocale(rawLocale), [rawLocale]);
  const context = useMemo(() => ({ returnTo, intent, entity, locale, authIntent }), [authIntent, entity, intent, locale, returnTo]);
  const t = copy[locale];
  const normalized = nickname.normalize("NFKC").trim();
  const count = graphemeCount(nickname, locale);
  const localValid = isLocallyValid(nickname, locale);

  const currentOnboardingPath = appendLoginContext("/onboarding/profile", context);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
      return;
    }

    const controller = new AbortController();
    setState("checking");
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing token");
        const response = await fetch("/api/me/profile", {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const body = await jsonBody(response);
        if (response.status === 401) {
          replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
          return;
        }
        if (!response.ok) throw new Error("profile unavailable");
        if (body.profile?.completed) {
          sessionStorage.removeItem(draftStorageKey);
          replace(returnTo as Route);
          return;
        }
        const draft = sessionStorage.getItem(draftStorageKey) ?? "";
        setNickname(draft);
        setState(draft ? isLocallyValid(draft, locale) ? "valid" : "typing" : "empty");
        requestAnimationFrame(() => inputRef.current?.focus());
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState("network");
      }
    })();
    return () => controller.abort();
  }, [authenticated, context, currentOnboardingPath, getAccessToken, locale, ready, replace, returnTo]);

  const updateNickname = useCallback((value: string) => {
    setNickname(value);
    sessionStorage.setItem(draftStorageKey, value);
    if (!value) setState("empty");
    else setState(isLocallyValid(value, locale) ? "valid" : "typing");
  }, [locale]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!localValid || state === "saving" || state === "saved") {
      setState(nickname ? "invalid" : "empty");
      inputRef.current?.focus();
      return;
    }

    setState("saving");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const response = await fetch("/api/me/nickname", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ nickname: normalized }), cache: "no-store",
      });
      const body = await jsonBody(response);
      if (response.status === 401) {
        replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
        return;
      }
      if (!response.ok) {
        const code = body.error?.code;
        const reason = body.error?.details?.reason;
        if (code === "NICKNAME_TAKEN") setState("duplicate");
        else if (code === "NICKNAME_PROHIBITED" || reason === "prohibited") setState("prohibited");
        else if (code === "PROFILE_ALREADY_COMPLETED") {
          replace(returnTo as Route);
          return;
        }
        else if (code === "INVALID_NICKNAME") setState("invalid");
        else setState("network");
        inputRef.current?.focus();
        return;
      }
      const savedNickname = body.profile?.nickname ?? normalized;
      sessionStorage.removeItem(draftStorageKey);
      setNickname(savedNickname);
      setState("saved");
      const completionDelay = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
      window.setTimeout(() => replace(returnTo as Route), completionDelay);
    } catch {
      setState("network");
      inputRef.current?.focus();
    }
  };

  const statusText = t[state];
  const invalid = state === "duplicate" || state === "prohibited" || state === "invalid";
  const canSave = localValid && state !== "saving" && state !== "saved" && state !== "checking";
  const displayOwner = normalized || t.placeholderOwner;

  return (
    <div className={styles.page} data-state={state}>
      <FocusFlowHeader className={styles.header} innerClassName={styles.headerInner}>
        <nav className={styles.locale} aria-label={t.language}>
          <Link aria-current={locale === "ko" ? "page" : undefined} href={appendLoginContext("/onboarding/profile", { ...context, locale: "ko" }) as Route}>KO</Link>
          <span aria-hidden="true">/</span>
          <Link aria-current={locale === "en" ? "page" : undefined} href={appendLoginContext("/onboarding/profile", { ...context, locale: "en" }) as Route}>EN</Link>
        </nav>
      </FocusFlowHeader>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="profile-heading">
          <h1 id="profile-heading">{t.heading}</h1><p>{t.subtitle}</p>
        </section>

        <div className={styles.composition}>
          <section className={styles.preview} aria-label={t.preview} aria-live="polite">
            <div className={styles.passportHead}><span>BYUS · KARA</span><strong>{t.passport}</strong></div>
            <dl>
              <div className={styles.ownerRow}><dt>{t.owner}</dt><dd>{displayOwner}</dd></div>
              <div><dt>{t.tier}</dt><dd>—</dd></div><div><dt>{t.score}</dt><dd>0</dd></div><div><dt>{t.stamps}</dt><dd>0</dd></div>
              <div><dt>{t.issuance}</dt><dd>{t.issuanceValue}</dd></div>
            </dl>
          </section>

          <form className={styles.form} onSubmit={submit} noValidate>
            <div className={styles.fieldHead}><label htmlFor="nickname">{t.field}</label><span aria-label={t.counter(count)}>{count}/16</span></div>
            <input ref={inputRef} id="nickname" name="nickname" value={nickname} onChange={(event) => updateNickname(event.target.value)}
              maxLength={32} autoComplete="nickname" enterKeyHint="done" aria-invalid={invalid} aria-describedby="nickname-status nickname-rules nickname-privacy"
              disabled={state === "checking" || state === "saving" || state === "saved"} />
            <p id="nickname-status" className={styles.status} data-tone={invalid ? "error" : state === "valid" || state === "saved" ? "success" : "neutral"} role={invalid || state === "network" ? "alert" : "status"}>{statusText}</p>
            <p id="nickname-rules" className={styles.rule}>{t.rule}</p>
            <p id="nickname-privacy" className={styles.privacy}>{t.privacy}</p>
            <div className={styles.actions}>
              <button className={styles.primary} type="submit" disabled={!canSave}>{state === "saving" ? t.saving : state === "saved" ? t.saved : t.save}</button>
              <Link className={styles.secondary} href={returnTo as Route}>{t.back}</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
