"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  Bell,
  ChevronLeft,
  Download,
  Globe2,
  Pencil,
  Smartphone,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  enablePushNotifications,
} from "../../notification/ui/push-subscription";
import styles from "./settings-screen.module.css";

type Locale = "ko" | "en";
type PreferenceKey =
  "liveReminders" | "surveyReminders" | "benefitNotifications";
interface SettingsSummary {
  nickname: string;
  wallet: { chainId: number; maskedAddress: string } | null;
}
interface Preferences {
  liveReminders: boolean;
  surveyReminders: boolean;
  benefitNotifications: boolean;
  browserSubscription: "subscribed" | "unsubscribed";
}
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type BrowserPermissionState =
  | "pending"
  | "default"
  | "granted"
  | "denied"
  | "unsupported"
  | "insecure";
type PushConnectionState = "idle" | "pending" | "subscribed" | "error";
type InstallState =
  | "checking"
  | "available"
  | "pending"
  | "installed"
  | "unsupported"
  | "error";

export function resolveBrowserPermissionState(input: {
  secureContext: boolean;
  hasNotification: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  permission?: NotificationPermission;
}): Exclude<BrowserPermissionState, "pending"> {
  if (!input.secureContext) return "insecure";
  if (
    !input.hasNotification ||
    !input.hasPushManager ||
    !input.hasServiceWorker
  )
    return "unsupported";
  return input.permission ?? "default";
}

const copy = {
  ko: {
    back: "홈으로",
    title: "설정",
    subtitle: "ByUs에서 사용할 프로필과 알림을 관리하세요.",
    profile: "프로필",
    nickname: "닉네임",
    edit: "변경",
    save: "저장",
    saving: "저장 중…",
    cancel: "취소",
    nicknameRule: "2–16자, 한글·영문·숫자를 사용할 수 있어요.",
    language: "언어",
    languageHelp: "선택한 언어는 이 브라우저에 저장됩니다.",
    korean: "한국어",
    english: "English",
    notifications: "알림",
    notificationHelp: "받고 싶은 소식만 선택할 수 있어요.",
    live: "LIVE 시작 알림",
    survey: "설문 참여 알림",
    benefit: "혜택 오픈 알림",
    browserConnect: "브라우저 알림 연결",
    browserReconnect: "현재 브라우저 연결",
    permissionLabel: "현재 브라우저 권한",
    permissionPending: "브라우저 상태 확인 중",
    permissionDefault: "아직 알림 권한을 요청하지 않았어요.",
    permissionGranted: "알림 권한이 허용되어 있어요.",
    pushDenied: "브라우저 설정에서 알림 권한을 허용해 주세요.",
    pushUnsupported: "이 브라우저는 푸시 알림을 지원하지 않습니다.",
    pushInsecure: "보안 연결(HTTPS)에서만 브라우저 알림을 사용할 수 있어요.",
    pushPending: "브라우저 알림을 연결하는 중이에요.",
    pushFailed: "브라우저 알림을 연결하지 못했어요. 다시 시도해 주세요.",
    subscriptionLabel: "계정 알림 연결",
    subscriptionOn: "등록된 브라우저 알림이 있어요.",
    subscriptionOff: "등록된 브라우저 알림이 없어요.",
    wallet: "연결된 지갑",
    walletHelp:
      "Privy가 생성한 지갑은 변경하거나 출금할 수 없으며 주소는 일부만 표시됩니다.",
    noWallet: "지갑 준비 중",
    install: "앱 설치",
    installHelp: "홈 화면에 ByUs를 추가하면 더 빠르게 열 수 있어요.",
    installAction: "ByUs 설치하기",
    installChecking: "설치 가능 여부를 확인하고 있어요.",
    installing: "설치 요청 확인 중…",
    installed: "이 기기에 설치됨",
    unsupported: "브라우저 메뉴의 ‘홈 화면에 추가’를 이용해 주세요.",
    installFailed: "설치 요청을 열지 못했어요. 브라우저 메뉴를 이용해 주세요.",
    loading: "설정을 불러오는 중",
    unavailable: "설정을 불러오지 못했어요. 다시 시도해 주세요.",
    retry: "다시 시도",
    auth: "로그인 후 설정을 이용할 수 있어요.",
    duplicate: "이미 사용 중인 닉네임이에요.",
    prohibited: "사용할 수 없는 표현이 포함되어 있어요.",
    invalid: "닉네임의 길이 또는 문자를 확인해 주세요.",
    saved: "변경 사항을 저장했어요.",
    failed: "저장하지 못했어요. 다시 시도해 주세요.",
  },
  en: {
    back: "Home",
    title: "Settings",
    subtitle: "Manage your ByUs profile and notifications.",
    profile: "Profile",
    nickname: "Nickname",
    edit: "Change",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    nicknameRule: "Use 2–16 Korean or Latin letters and numbers.",
    language: "Language",
    languageHelp: "Your selection is saved in this browser.",
    korean: "한국어",
    english: "English",
    notifications: "Notifications",
    notificationHelp: "Choose only the updates you want.",
    live: "LIVE start reminders",
    survey: "Survey reminders",
    benefit: "Benefit alerts",
    browserConnect: "Connect browser notifications",
    browserReconnect: "Connect this browser",
    permissionLabel: "This browser's permission",
    permissionPending: "Checking browser status",
    permissionDefault: "Notification permission has not been requested yet.",
    permissionGranted: "Notification permission is allowed.",
    pushDenied: "Allow notifications in your browser settings.",
    pushUnsupported: "Push notifications are not supported in this browser.",
    pushInsecure: "Browser notifications require a secure HTTPS connection.",
    pushPending: "Connecting browser notifications.",
    pushFailed: "We couldn't connect browser notifications. Try again.",
    subscriptionLabel: "Account notification connection",
    subscriptionOn: "Your account has a registered browser notification.",
    subscriptionOff: "Your account has no registered browser notification.",
    wallet: "Connected wallet",
    walletHelp:
      "Your Privy wallet cannot be changed or withdrawn here. Only a masked address is shown.",
    noWallet: "Wallet is being prepared",
    install: "Install app",
    installHelp: "Add ByUs to your home screen for faster access.",
    installAction: "Install ByUs",
    installChecking: "Checking installation availability.",
    installing: "Waiting for installation…",
    installed: "Installed on this device",
    unsupported: "Use your browser’s Add to Home Screen menu.",
    installFailed: "We couldn't open the install request. Use your browser menu.",
    loading: "Loading settings",
    unavailable: "We couldn't load your settings. Try again.",
    retry: "Try again",
    auth: "Log in to use Settings.",
    duplicate: "That nickname is already in use.",
    prohibited: "That nickname contains a restricted expression.",
    invalid: "Check the nickname length and characters.",
    saved: "Your changes were saved.",
    failed: "We couldn't save that. Try again.",
  },
} as const;

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export function SettingsScreen({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [installState, setInstallState] = useState<InstallState>("checking");
  const [permissionState, setPermissionState] =
    useState<BrowserPermissionState>("pending");
  const [pushState, setPushState] =
    useState<PushConnectionState>("idle");
  const nicknameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!ready || !authenticated) return;
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("token");
      const headers = authHeaders(token);
      const [settingsResponse, preferenceResponse] = await Promise.all([
        fetch("/api/me/settings", { headers, cache: "no-store" }),
        fetch("/api/notifications/preferences", { headers, cache: "no-store" }),
      ]);
      if (!settingsResponse.ok || !preferenceResponse.ok)
        throw new Error("response");
      const settingsBody = (await settingsResponse.json()) as {
        settings: SettingsSummary;
      };
      const preferenceBody = (await preferenceResponse.json()) as {
        preferences: Preferences;
      };
      setSettings(settingsBody.settings);
      setNickname(settingsBody.settings.nickname);
      setPreferences(preferenceBody.preferences);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [authenticated, getAccessToken, ready]);

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace(
        `/login?returnTo=${encodeURIComponent(`/settings?locale=${locale}`)}&locale=${locale}`,
      );
      return;
    }
    void load();
  }, [authenticated, load, locale, ready, router]);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("byus:locale", locale);
    document.cookie = `byus_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & {
      standalone?: boolean;
    };
    const isInstalled =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      navigatorWithStandalone.standalone === true;
    setInstallState(isInstalled ? "installed" : "unsupported");
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setInstallState("available");
    };
    const installedHandler = () => {
      setInstallState("installed");
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  useEffect(() => {
    setPermissionState(
      resolveBrowserPermissionState({
        secureContext: window.isSecureContext !== false,
        hasNotification: "Notification" in window,
        hasPushManager: "PushManager" in window,
        hasServiceWorker: "serviceWorker" in navigator,
        permission:
          "Notification" in window ? Notification.permission : undefined,
      }),
    );
  }, []);

  async function rename(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("token");
      const response = await fetch("/api/me/nickname", {
        method: "PUT",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const body = (await response.json()) as {
        profile?: { nickname: string };
        error?: { code?: string };
      };
      if (!response.ok || !body.profile) {
        const code = body.error?.code;
        setMessage(
          code === "NICKNAME_TAKEN"
            ? t.duplicate
            : code === "NICKNAME_PROHIBITED"
              ? t.prohibited
              : code === "INVALID_NICKNAME"
                ? t.invalid
                : t.failed,
        );
        nicknameRef.current?.focus();
        return;
      }
      setSettings((current) =>
        current ? { ...current, nickname: body.profile!.nickname } : current,
      );
      setNickname(body.profile.nickname);
      setEditing(false);
      setMessage(t.saved);
    } catch {
      setMessage(t.failed);
      nicknameRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  async function updatePreference(key: PreferenceKey, value: boolean) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setMessage("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("token");
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const body = (await response.json()) as { preferences?: Preferences };
      if (!response.ok || !body.preferences) throw new Error("save");
      setPreferences(body.preferences);
      setMessage(t.saved);
    } catch {
      setPreferences(previous);
      setMessage(t.failed);
    }
  }

  async function install() {
    if (!installPrompt) return;
    setInstallState("pending");
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setInstallState(choice.outcome === "accepted" ? "pending" : "unsupported");
    } catch {
      setInstallPrompt(null);
      setInstallState("error");
    }
  }

  async function connectPush() {
    const currentPermission = resolveBrowserPermissionState({
      secureContext: window.isSecureContext !== false,
      hasNotification: "Notification" in window,
      hasPushManager: "PushManager" in window,
      hasServiceWorker: "serviceWorker" in navigator,
      permission:
        "Notification" in window ? Notification.permission : undefined,
    });
    setPermissionState(currentPermission);
    if (
      currentPermission === "denied" ||
      currentPermission === "unsupported" ||
      currentPermission === "insecure"
    )
      return;
    setPushState("pending");
    const result = await enablePushNotifications(getAccessToken);
    const permissionAfterRequest =
      "Notification" in window ? Notification.permission : undefined;
    if (permissionAfterRequest)
      setPermissionState(permissionAfterRequest);
    if (result === "subscribed") {
      setPushState("subscribed");
      setPreferences((current) =>
        current ? { ...current, browserSubscription: "subscribed" } : current,
      );
      return;
    }
    if (result === "denied") {
      setPushState("idle");
      return;
    }
    if (result === "unsupported") {
      setPermissionState("unsupported");
      setPushState("idle");
      return;
    }
    setPushState("error");
  }

  if (!ready || state === "loading")
    return (
      <main className={styles.center} aria-busy="true">
        <span className={styles.spinner} />
        {t.loading}
      </main>
    );
  if (!authenticated) return <main className={styles.center}>{t.auth}</main>;
  if (state === "error" || !settings || !preferences)
    return (
      <main className={styles.center}>
        <p>{t.unavailable}</p>
        <button onClick={() => void load()}>{t.retry}</button>
      </main>
    );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href={`/?locale=${locale}`} aria-label={t.back}>
            <ChevronLeft />
            {t.back}
          </Link>
          <span className={styles.wordmark}>ByUs</span>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <p>FAN-020</p>
          <h1>{t.title}</h1>
          <span>{t.subtitle}</span>
        </div>

        <section className={styles.section} aria-labelledby="profile-title">
          <div className={styles.sectionTitle}>
            <div className={styles.icon}>
              <Pencil />
            </div>
            <div>
              <h2 id="profile-title">{t.profile}</h2>
              <p>{t.nickname}</p>
            </div>
          </div>
          {!editing ? (
            <div className={styles.valueRow}>
              <strong>{settings.nickname}</strong>
              <button
                onClick={() => {
                  setEditing(true);
                  setMessage("");
                  requestAnimationFrame(() => nicknameRef.current?.focus());
                }}
              >
                {t.edit}
              </button>
            </div>
          ) : (
            <form className={styles.renameForm} onSubmit={rename}>
              <label htmlFor="settings-nickname">{t.nickname}</label>
              <input
                ref={nicknameRef}
                id="settings-nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={16}
                autoComplete="nickname"
                aria-describedby="nickname-rule settings-message"
              />
              <small id="nickname-rule">{t.nicknameRule}</small>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setNickname(settings.nickname);
                    setMessage("");
                  }}
                >
                  {t.cancel}
                </button>
                <button
                  className={styles.primary}
                  disabled={saving}
                  type="submit"
                >
                  {saving ? t.saving : t.save}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className={styles.section} aria-labelledby="language-title">
          <div className={styles.sectionTitle}>
            <div className={styles.icon}>
              <Globe2 />
            </div>
            <div>
              <h2 id="language-title">{t.language}</h2>
              <p>{t.languageHelp}</p>
            </div>
          </div>
          <div
            className={styles.segmented}
            role="group"
            aria-label={t.language}
          >
            <button
              aria-pressed={locale === "ko"}
              onClick={() => router.replace("/settings?locale=ko" as Route)}
            >
              {t.korean}
            </button>
            <button
              aria-pressed={locale === "en"}
              onClick={() => router.replace("/settings?locale=en" as Route)}
            >
              {t.english}
            </button>
          </div>
        </section>

        <section
          className={styles.section}
          aria-labelledby="notifications-title"
        >
          <div className={styles.sectionTitle}>
            <div className={styles.icon}>
              <Bell />
            </div>
            <div>
              <h2 id="notifications-title">{t.notifications}</h2>
              <p>{t.notificationHelp}</p>
            </div>
          </div>
          <div className={styles.toggles}>
            {(
              [
                ["liveReminders", t.live],
                ["surveyReminders", t.survey],
                ["benefitNotifications", t.benefit],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={preferences[key]}
                  onChange={(event) =>
                    void updatePreference(key, event.target.checked)
                  }
                />
              </label>
            ))}
          </div>
          <div className={styles.pushRow}>
            <dl className={styles.stateList} aria-live="polite">
              <div>
                <dt>{t.permissionLabel}</dt>
                <dd data-state={permissionState}>
                  {permissionState === "pending"
                    ? t.permissionPending
                    : permissionState === "default"
                      ? t.permissionDefault
                      : permissionState === "granted"
                        ? t.permissionGranted
                        : permissionState === "denied"
                          ? t.pushDenied
                          : permissionState === "insecure"
                            ? t.pushInsecure
                            : t.pushUnsupported}
                </dd>
              </div>
              <div>
                <dt>{t.subscriptionLabel}</dt>
                <dd
                  data-state={
                    pushState === "pending" || pushState === "error"
                      ? pushState
                      : preferences.browserSubscription
                  }
                >
                  {pushState === "pending"
                    ? t.pushPending
                    : pushState === "error"
                      ? t.pushFailed
                      : preferences.browserSubscription === "subscribed" ||
                          pushState === "subscribed"
                        ? t.subscriptionOn
                        : t.subscriptionOff}
                </dd>
              </div>
            </dl>
            {(permissionState === "default" ||
              (permissionState === "granted" &&
                preferences.browserSubscription === "unsubscribed") ||
              pushState === "error") && (
              <button
                disabled={pushState === "pending"}
                onClick={() => void connectPush()}
              >
                {permissionState === "granted"
                  ? t.browserReconnect
                  : t.browserConnect}
              </button>
            )}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="wallet-title">
          <div className={styles.sectionTitle}>
            <div className={styles.icon}>
              <WalletCards />
            </div>
            <div>
              <h2 id="wallet-title">{t.wallet}</h2>
              <p>{t.walletHelp}</p>
            </div>
          </div>
          <div className={styles.walletValue}>
            <code>{settings.wallet?.maskedAddress ?? t.noWallet}</code>
            {settings.wallet && (
              <span>GIWA · Chain {settings.wallet.chainId}</span>
            )}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="install-title">
          <div className={styles.sectionTitle}>
            <div className={styles.icon}>
              <Smartphone />
            </div>
            <div>
              <h2 id="install-title">{t.install}</h2>
              <p>{t.installHelp}</p>
            </div>
          </div>
          {installState === "checking" ? (
            <p className={styles.support} role="status">
              {t.installChecking}
            </p>
          ) : installState === "installed" ? (
            <p className={styles.installState}>{t.installed}</p>
          ) : installState === "available" && installPrompt ? (
            <button
              className={styles.installButton}
              onClick={() => void install()}
            >
              <Download />
              {t.installAction}
            </button>
          ) : installState === "pending" ? (
            <p className={styles.installState} role="status">
              {t.installing}
            </p>
          ) : installState === "error" ? (
            <p className={styles.support} role="alert">
              {t.installFailed}
            </p>
          ) : (
            <p className={styles.support}>{t.unsupported}</p>
          )}
        </section>
        <p
          id="settings-message"
          className={styles.message}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      </main>
    </div>
  );
}
