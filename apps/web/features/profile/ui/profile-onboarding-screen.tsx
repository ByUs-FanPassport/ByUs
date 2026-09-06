"use client";

import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { FanAction } from "@/components/fan-ui/fan-action";
import {
  getNicknameFormat,
  getNicknameFormatMessage,
  type NicknameFormatReason,
} from "../domain/nickname-format";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "../../../components/login-intent";
import styles from "./profile-onboarding-screen.module.css";

type ScreenState = "checking" | "empty" | "typing" | "valid" | "duplicate" | "prohibited" | "invalid" | "saving" | "saved" | "network";

type Copy = {
  home: string; language: string; heading: (name: string) => string; subtitle: (name: string) => string; preview: string;
  progress: string;
  verification: string; pending: string; owner: string; placeholderOwner: string; issuance: string;
  field: string; counter: (count: number) => string; rule: string; privacy: string;
  save: string; saving: string; saved: string; back: string; checking: string; empty: string; typing: string;
  valid: string; duplicate: string; prohibited: string; invalid: string; network: string; auth: string;
};

const copy: Record<"ko" | "en", Copy> = {
  ko: {
    home: "ByUs 홈", language: "언어", heading: (name) => `${name} 팬 인증에 사용할 닉네임을 정해 주세요.`,
    subtitle: (name) => `팬 인증을 통과하면 ${name} Fan Passport와 활동 기록에 표시돼요.`, preview: "발급 예정 Fan Passport 미리보기",
    progress: "프로필 설정 · 1 / 1",
    verification: "팬 인증 준비", pending: "발급 예정", owner: "공개 이름", placeholderOwner: "닉네임",
    issuance: "팬 인증 완료 후 발급", field: "닉네임", counter: (count) => `${count}/32자`,
    rule: "원하는 언어로 1–32자까지 입력해 주세요.",
    privacy: "입력한 닉네임만 공개되며 이메일과 Google 계정 정보는 표시되지 않아요.",
    save: "닉네임 저장", saving: "저장 중…", saved: "저장 완료", back: "이전으로",
    checking: "프로필을 확인하고 있어요.", empty: "사용할 닉네임을 입력해 주세요.",
    typing: "원하는 언어로 표시 이름을 입력해 주세요.", valid: "사용 가능한 형식이에요. 저장할 때 중복 여부를 확인합니다.",
    duplicate: "이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.",
    prohibited: "사용할 수 없는 표현이 포함되어 있어요. 다른 닉네임을 입력해 주세요.",
    invalid: "닉네임의 길이 또는 문자를 확인해 주세요.",
    network: "저장하지 못했어요. 입력한 닉네임을 유지했으니 다시 시도해 주세요.",
    auth: "로그인 후 닉네임 설정을 이어갈 수 있어요.",
  },
  en: {
    home: "ByUs home", language: "Language", heading: (name) => `Choose a display name for your ${name} fan verification.`,
    subtitle: (name) => `After verification, it will appear in your ${name} Fan Passport and activity history.`, preview: "Fan Passport preview before issuance",
    progress: "Profile setup · 1 / 1",
    verification: "Fan verification", pending: "Pending issuance", owner: "Public name", placeholderOwner: "Display name",
    issuance: "Issued after fan verification", field: "Display name", counter: (count) => `${count}/32 characters`,
    rule: "Use 1–32 characters in your preferred language.",
    privacy: "Only this display name is public. Your email and Google account details are never shown.",
    save: "Save display name", saving: "Saving…", saved: "Saved", back: "Go back",
    checking: "Checking your profile.", empty: "Enter the display name you want to use.",
    typing: "Enter your display name in your preferred language.", valid: "The format is valid. Availability is checked when you save.",
    duplicate: "This display name is taken. Try another.",
    prohibited: "This display name contains a restricted term. Try another.",
    invalid: "Check the display name length and characters.",
    network: "We couldn't save it. Your display name is still here, so you can try again.",
    auth: "Log in to continue setting your display name.",
  },
};

const draftStorageKey = "byus:profile-nickname-draft";

async function jsonBody(response: Response) {
  try { return await response.json() as { profile?: { completed?: boolean; nickname?: string | null }; error?: { code?: string; details?: { reason?: string } } }; }
  catch { return {}; }
}

export function ProfileOnboardingScreen({ celebrity }: { celebrity: PublishedCelebrity }) {
  const { replace } = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const inputRef = useRef<HTMLInputElement>(null);
  const loginRedirectedRef = useRef(false);
  const composingRef = useRef(false);
  const savePendingRef = useRef(false);
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<ScreenState>("checking");
  const [validationVisible, setValidationVisible] = useState(false);
  const [serverFormatReason, setServerFormatReason] = useState<NicknameFormatReason | null>(null);
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
  const nicknameFormat = getNicknameFormat(nickname);
  const normalized = nicknameFormat.nickname;
  const count = nicknameFormat.length;
  const localValid = nicknameFormat.valid;

  const currentOnboardingPath = appendLoginContext("/onboarding/profile", context);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      if (!loginRedirectedRef.current) {
        loginRedirectedRef.current = true;
        replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
      }
      return;
    }
    loginRedirectedRef.current = false;

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
          if (!loginRedirectedRef.current) {
            loginRedirectedRef.current = true;
            replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
          }
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
        setState(draft ? getNicknameFormat(draft).valid ? "valid" : "typing" : "empty");
        setValidationVisible(false);
        setServerFormatReason(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState("network");
      }
    })();
    return () => controller.abort();
  }, [authenticated, context, currentOnboardingPath, getAccessToken, ready, replace, returnTo]);

  const updateNickname = useCallback((value: string) => {
    setNickname(value);
    setServerFormatReason(null);
    sessionStorage.setItem(draftStorageKey, value);
    if (composingRef.current) {
      setState("typing");
      return;
    }
    const format = getNicknameFormat(value);
    if (validationVisible && !format.valid) setState("invalid");
    else {
      setValidationVisible(false);
      setState(!value ? "empty" : format.valid ? "valid" : "typing");
    }
  }, [validationVisible]);

  const focusNickname = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (
      state === "duplicate"
      || state === "prohibited"
      || state === "invalid"
      || state === "network"
    ) {
      inputRef.current?.focus();
    }
  }, [state]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (composingRef.current || savePendingRef.current) return;
    if (!localValid || state === "checking" || state === "saving" || state === "saved") {
      setValidationVisible(true);
      setState("invalid");
      focusNickname();
      return;
    }

    savePendingRef.current = true;
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
        if (!loginRedirectedRef.current) {
          loginRedirectedRef.current = true;
          replace(appendLoginContext("/login", { ...context, returnTo: currentOnboardingPath }) as Route);
        }
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
        else if (code === "INVALID_NICKNAME") {
          const detailReason = body.error?.details?.reason;
          setServerFormatReason(
            detailReason === "empty"
            || detailReason === "too_long"
            || detailReason === "newline"
            || detailReason === "unsupported"
              ? detailReason
              : null,
          );
          setValidationVisible(true);
          setState("invalid");
        }
        else setState("network");
        focusNickname();
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
      focusNickname();
    } finally {
      savePendingRef.current = false;
    }
  };

  const statusText = state === "invalid"
    ? getNicknameFormatMessage(serverFormatReason ?? nicknameFormat.reason, locale) || t.invalid
    : t[state];
  const invalid = state === "duplicate" || state === "prohibited" || state === "invalid";
  const canSave = state !== "saving" && state !== "saved" && state !== "checking";
  const displayOwner = normalized || t.placeholderOwner;

  return (
    <FocusFlowFrame
      locale={locale}
      mainId="profile-onboarding-main"
      showFooter
      headerActions={
        <nav className={styles.locale} aria-label={t.language}>
          <Link aria-current={locale === "ko" ? "page" : undefined} href={appendLoginContext("/onboarding/profile", { ...context, locale: "ko" }) as Route}>KO</Link>
          <span aria-hidden="true">/</span>
          <Link aria-current={locale === "en" ? "page" : undefined} href={appendLoginContext("/onboarding/profile", { ...context, locale: "en" }) as Route}>EN</Link>
        </nav>
      }
    >

      <main className={styles.main} id="profile-onboarding-main" tabIndex={-1} data-state={state}>
        <section className={styles.intro} aria-labelledby="profile-heading">
          <p className={styles.progress} aria-label={t.progress}>{t.progress}</p>
          <h1 id="profile-heading">{t.heading(celebrity.name)}</h1><p>{t.subtitle(celebrity.name)}</p>
        </section>

        <div className={styles.composition}>
          <section className={styles.preview} aria-label={t.preview} aria-live="polite">
            <div className={styles.celebrityContext}>
              <CreatorAvatar slug={celebrity.slug} src={celebrity.image.url} size={{ mobile: 48, desktop: 56 }} alt={celebrity.image.alt} />
              <div><span>{t.verification}</span><strong>{celebrity.name}</strong></div>
              <em>{t.pending}</em>
            </div>
            <div className={styles.passportArtwork}>
              <Image
                src="/images/guest-home/passport-open-blank-9-transparent.png"
                alt=""
                width={1536}
                height={1024}
                sizes="(min-width: 768px) 420px, calc(100vw - 80px)"
                priority
              />
            </div>
            <dl>
              <div className={styles.ownerRow}><dt>{t.owner}</dt><dd dir="auto">{displayOwner}</dd></div>
              <div><dt>{locale === "ko" ? "상태" : "Status"}</dt><dd>{t.issuance}</dd></div>
            </dl>
          </section>

          <form className={styles.form} onSubmit={submit} noValidate aria-busy={state === "checking" || state === "saving"}>
            <div className={styles.fieldHead}><label htmlFor="nickname">{t.field}</label><span aria-label={t.counter(count)}>{count}/32</span></div>
            <input ref={inputRef} id="nickname" name="nickname" value={nickname} onChange={(event) => updateNickname(event.target.value)}
              onBlur={() => {
                if (composingRef.current) return;
                if (!getNicknameFormat(nickname).valid) {
                  setValidationVisible(true);
                  setState("invalid");
                }
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                setServerFormatReason(null);
                setState("typing");
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                updateNickname(event.currentTarget.value);
              }}
              dir="auto" autoComplete="nickname" enterKeyHint="done" aria-invalid={invalid} aria-describedby="nickname-status nickname-rules nickname-privacy"
              disabled={state === "checking" || state === "saving" || state === "saved"} />
            <p id="nickname-status" className={styles.status} data-tone={invalid ? "error" : state === "valid" || state === "saved" ? "success" : "neutral"} role={invalid || state === "network" ? "alert" : "status"}>{statusText}</p>
            <p id="nickname-rules" className={styles.rule}>{t.rule}</p>
            <p id="nickname-privacy" className={styles.privacy}>{t.privacy}</p>
            <div className={styles.actions}>
              <FanAction variant="primary" type="submit" disabled={!canSave} ariaBusy={state === "saving"}>
                {state === "saving" ? t.saving : state === "saved" ? t.saved : t.save}
              </FanAction>
              <Link className={styles.secondary} href={returnTo as Route}>{t.back}</Link>
            </div>
          </form>
        </div>
      </main>
    </FocusFlowFrame>
  );
}
