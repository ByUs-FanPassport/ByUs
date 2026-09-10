"use client";

import { usePrivy } from "@privy-io/react-auth";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { FanState } from "@/components/fan-ui/fan-state";
import { FanSurface } from "@/components/fan-ui/fan-surface";
import { withLocalePath } from "@/components/locale-path";
import {
  BENEFIT_RECIPIENT_CONSENT_VERSION,
  recipientInputSchema,
  recipientSaveResultSchema,
} from "../domain/fulfillment";
import { myRewardsSchema, type MyReward } from "../domain/my-reward";
import {
  fulfillmentStatusLabel,
  recipientCopy,
  selectOwnedRecipientReward,
} from "./benefit-recipient-presentation";
import styles from "./benefit-recipient-screen.module.css";

const rewardsResponseSchema = z.object({ rewards: myRewardsSchema }).strict();

type Draft = {
  name: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
  consented: boolean;
};
type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;
type ReadResult =
  | { kind: "reward"; reward: MyReward }
  | { kind: "auth" | "missing" | "unavailable" };
type View =
  | { kind: "loading" | "auth" | "missing" | "unavailable" }
  | { kind: "reward"; reward: MyReward };
type SubmitPhase = "idle" | "posting" | "reconciling" | "confirmation_required";

const emptyDraft = (): Draft => ({
  name: "",
  phone: "",
  postalCode: "",
  address1: "",
  address2: "",
  consented: false,
});

async function readReward(input: {
  token: string;
  locale: FanLocale;
  winnerId: string;
  signal?: AbortSignal;
}): Promise<ReadResult> {
  try {
    const response = await fetch(`/api/me/rewards?locale=${input.locale}`, {
      headers: { Authorization: `Bearer ${input.token}` },
      cache: "no-store",
      signal: input.signal,
    });
    if (response.status === 401 || response.status === 403) return { kind: "auth" };
    if (!response.ok) return { kind: "unavailable" };
    const { rewards } = rewardsResponseSchema.parse(await response.json());
    const reward = selectOwnedRecipientReward(rewards, input.winnerId);
    return reward ? { kind: "reward", reward } : { kind: "missing" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { kind: "unavailable" };
  }
}

function nextView(result: ReadResult): View {
  return result.kind === "reward" ? result : { kind: result.kind };
}

export function BenefitRecipientScreen({
  winnerId,
  locale,
}: {
  winnerId: string;
  locale: FanLocale;
}) {
  const auth = usePrivy();
  const identityKey = `${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}:${winnerId}`;
  return <BenefitRecipientOwnerScreen key={identityKey} winnerId={winnerId} locale={locale} auth={auth} />;
}

function BenefitRecipientOwnerScreen({
  winnerId,
  locale,
  auth,
}: {
  winnerId: string;
  locale: FanLocale;
  auth: ReturnType<typeof usePrivy>;
}) {
  const { ready, authenticated, getAccessToken } = auth;
  const ownerId = auth.user?.id;
  const ownerKey = `${ownerId ?? "guest"}:${winnerId}`;
  const t = recipientCopy[locale];
  const [view, setView] = useState<View>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const currentOwnerKey = useRef(ownerKey);
  const latestLocale = useRef(locale);
  const readGeneration = useRef(0);
  const mounted = useRef(false);
  const postInFlight = useRef<Promise<void> | null>(null);
  const postController = useRef<AbortController | null>(null);
  const fieldRefs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  const recipientPathname = useMemo(() => `/my/rewards/${winnerId}/recipient`, [winnerId]);
  const recipientUrl = useMemo(
    () => withLocalePath(recipientPathname, locale),
    [locale, recipientPathname],
  );
  const loginUrl = useMemo(
    () => withLocalePath(`/login?returnTo=${encodeURIComponent(recipientUrl)}`, locale),
    [locale, recipientUrl],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      postController.current?.abort();
    };
  }, []);

  useEffect(() => {
    latestLocale.current = locale;
  }, [locale]);

  const clearPrivateState = useCallback(() => {
    setDraft(emptyDraft());
    setErrors({});
    setMessage(null);
  }, []);

  const load = useCallback(async (selectedLocale: FanLocale, signal?: AbortSignal): Promise<ReadResult> => {
    if (!authenticated) return { kind: "auth" };
    try {
      const token = await getAccessToken();
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!token) return { kind: "auth" };
      return readReward({ token, locale: selectedLocale, winnerId, signal });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      return { kind: "unavailable" };
    }
  }, [authenticated, getAccessToken, winnerId]);

  useEffect(() => {
    if (!ready) {
      setView({ kind: "loading" });
      return;
    }
    if (!authenticated) {
      setView({ kind: "auth" });
      return;
    }
    if (postInFlight.current) {
      setSubmitPhase("reconciling");
      return;
    }
    const requestKey = ownerKey;
    const controller = new AbortController();
    const generation = ++readGeneration.current;
    const retainedReward = view.kind === "reward";
    if (retainedReward) setSubmitPhase("reconciling");
    else setView({ kind: "loading" });
    void load(locale, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== readGeneration.current || !mounted.current || currentOwnerKey.current !== requestKey) return;
      if (postInFlight.current) {
        setSubmitPhase("reconciling");
        return;
      }
      if (result.kind === "unavailable" && retainedReward) {
        setMessage(t.confirmBody);
        setSubmitPhase("confirmation_required");
        return;
      }
      setView(nextView(result));
      setSubmitPhase("idle");
    }).catch(() => {});
    return () => {
      controller.abort();
      if (readGeneration.current === generation) readGeneration.current += 1;
    };
  // `view` is intentionally retained across locale reads; request ownership is
  // guarded by the keyed component and request key rather than effect closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, load, locale, ownerKey, ready, t.confirmBody]);

  const reward = view.kind === "reward" ? view.reward : null;
  const needsForm = Boolean(
    reward?.recipientRequired
      && reward.status === "information_required"
      && reward.method !== "digital",
  );

  function updateField(field: Field, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage(null);
  }

  function validate(method: MyReward["method"]): FieldErrors {
    const result: FieldErrors = {};
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    if (!name) result.name = t.requiredError;
    else if (name.length > 120) result.name = t.nameTooLong;
    if (!phone) result.phone = t.requiredError;
    else if (phone.length < 7 || phone.length > 40) result.phone = t.phoneLength;
    if (method === "physical_shipping") {
      const postalCode = draft.postalCode.trim();
      const address1 = draft.address1.trim();
      if (!postalCode) result.postalCode = t.requiredError;
      else if (postalCode.length > 20) result.postalCode = t.postalTooLong;
      if (!address1) result.address1 = t.requiredError;
      else if (address1.length > 300) result.address1 = t.addressTooLong;
      if (draft.address2.trim().length > 300) result.address2 = t.addressTooLong;
    }
    if (!draft.consented) result.consented = t.consentError;
    return result;
  }

  const reconcile = useCallback(async (requestKey: string) => {
    setSubmitPhase("reconciling");
    setMessage(recipientCopy[latestLocale.current].reconciling);
    let selectedLocale = latestLocale.current;
    let result = await load(selectedLocale);
    while (mounted.current && currentOwnerKey.current === requestKey && selectedLocale !== latestLocale.current) {
      selectedLocale = latestLocale.current;
      result = await load(selectedLocale);
    }
    if (!mounted.current || currentOwnerKey.current !== requestKey) return;
    const currentCopy = recipientCopy[selectedLocale];
    if (result.kind === "reward") {
      setView({ kind: "reward", reward: result.reward });
      if (result.reward.status !== "information_required" || !result.reward.recipientRequired) {
        clearPrivateState();
        setSubmitPhase("idle");
        return;
      }
      setDraft((current) => ({ ...current, consented: false }));
      setErrors({});
      setMessage(currentCopy.retrySubmit);
      setSubmitPhase("idle");
      return;
    }
    if (result.kind === "auth" || result.kind === "missing") {
      clearPrivateState();
      setView({ kind: result.kind });
      setSubmitPhase("idle");
      return;
    }
    setMessage(currentCopy.confirmBody);
    setSubmitPhase("confirmation_required");
  }, [clearPrivateState, load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (postInFlight.current || !reward || !needsForm || submitPhase !== "idle") return;
    const nextErrors = validate(reward.method);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      const first = (["name", "phone", "postalCode", "address1", "address2", "consented"] as Field[])
        .find((field) => nextErrors[field]);
      if (first) queueMicrotask(() => fieldRefs.current[first]?.focus());
      return;
    }

    const requestKey = ownerKey;
    const operation = (async () => {
      setSubmitPhase("posting");
      setMessage(null);
      let postStarted = false;
      let controller: AbortController | null = null;
      try {
        const token = await getAccessToken();
        if (!mounted.current || currentOwnerKey.current !== requestKey) return;
        if (!token) {
          clearPrivateState();
          setView({ kind: "auth" });
          setSubmitPhase("idle");
          return;
        }
        const input = recipientInputSchema.parse({
          consentVersion: BENEFIT_RECIPIENT_CONSENT_VERSION,
          consented: true,
          name: draft.name,
          phone: draft.phone,
          ...(reward.method === "physical_shipping"
            ? {
                postalCode: draft.postalCode,
                address1: draft.address1,
                ...(draft.address2.trim() ? { address2: draft.address2 } : {}),
              }
            : {}),
        });
        controller = new AbortController();
        postController.current = controller;
        postStarted = true;
        const response = await fetch(`/api/me/rewards/${winnerId}/recipient`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!mounted.current || currentOwnerKey.current !== requestKey) return;
        if (response.status === 400) {
          setMessage(recipientCopy[latestLocale.current].invalid);
          setSubmitPhase("idle");
          return;
        }
        if (response.status === 401 || response.status === 403) {
          clearPrivateState();
          setView({ kind: "auth" });
          setSubmitPhase("idle");
          return;
        }
        if (response.status === 404) {
          clearPrivateState();
          setView({ kind: "missing" });
          setSubmitPhase("idle");
          return;
        }
        if (response.ok) {
          try {
            recipientSaveResultSchema.parse(await response.json());
          } catch {
            // The write may have committed. Reconcile before allowing another POST.
          }
        }
        await reconcile(requestKey);
      } catch {
        if (!mounted.current || currentOwnerKey.current !== requestKey) return;
        if (postStarted) await reconcile(requestKey);
        else {
          setMessage(recipientCopy[latestLocale.current].unavailable);
          setSubmitPhase("idle");
        }
      } finally {
        if (controller && postController.current === controller) postController.current = null;
      }
    })();
    postInFlight.current = operation;
    void operation.then(() => {
      if (postInFlight.current === operation) postInFlight.current = null;
    }, () => {
      if (postInFlight.current === operation) postInFlight.current = null;
    });
  }

  async function confirmStatus() {
    if (submitPhase !== "confirmation_required") return;
    await reconcile(ownerKey);
  }

  async function retryInitialRead() {
    const requestKey = ownerKey;
    setView({ kind: "loading" });
    const generation = ++readGeneration.current;
    const result = await load(locale);
    if (generation === readGeneration.current && mounted.current && currentOwnerKey.current === requestKey)
      setView(nextView(result));
  }

  const main = (content: React.ReactNode) => (
    <FanAppFrame locale={locale} mainId="recipient-content" currentPath={recipientPathname}>
      <FanContentContainer as="main" className={styles.main} id="recipient-content" tabIndex={-1}>
        {content}
      </FanContentContainer>
    </FanAppFrame>
  );

  if (!ready || view.kind === "loading")
    return main(<FanState kind="loading" title={t.loading} />);
  if (view.kind === "auth")
    return main(<FanState kind="empty" title={t.session} description={t.sessionBody} actions={<FanAction variant="primary" href={loginUrl}>{t.login}</FanAction>} />);
  if (view.kind === "missing")
    return main(<FanState kind="empty" title={t.missing} description={t.missingBody} actions={<FanAction href={withLocalePath("/my", locale)}>{t.backMy}</FanAction>} />);
  if (view.kind === "unavailable")
    return main(<FanState kind="error" title={t.unavailable} actions={<FanAction onClick={() => void retryInitialRead()}>{t.retry}</FanAction>} />);
  if (!reward) return null;

  const detailUrl = withLocalePath(reward.benefitHref, locale);
  if (!needsForm) {
    const title = reward.method === "digital" || reward.status === "information_required" ? t.noInput : t.success;
    return main(<FanSurface className={styles.result}>
      <CheckCircle2 aria-hidden="true" />
      <FanHeading as="h1" variant="personal-page">{title}</FanHeading>
      <p>{reward.title}</p>
      <dl><div><dt>{t.currentStatus}</dt><dd>{fulfillmentStatusLabel[reward.status][locale]}</dd></div></dl>
      <div className={styles.actions}><FanAction variant="primary" href={withLocalePath("/my", locale)}>{t.backMy}</FanAction><FanAction href={detailUrl}>{t.benefit}</FanAction></div>
    </FanSurface>);
  }

  const shipping = reward.method === "physical_shipping";
  const busy = submitPhase === "posting" || submitPhase === "reconciling";
  const locked = submitPhase === "confirmation_required";
  const field = (name: Exclude<Field, "consented">, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => {
    const errorId = `${name}-error`;
    return <label className={styles.field} htmlFor={name}>
      <span>{label}{props.required ? <small>{t.required}</small> : null}</span>
      <input {...props} id={name} ref={(node) => { fieldRefs.current[name] = node; }} value={draft[name] as string} disabled={busy || locked} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? errorId : undefined} onChange={(event) => updateField(name, event.target.value)} />
      {errors[name] ? <em id={errorId}>{errors[name]}</em> : null}
    </label>;
  };

  return main(<div className={styles.layout}>
    <header className={styles.heading}>
      <FanHeading as="h1" variant="personal-page">{t.title}</FanHeading>
      <strong>{reward.title}</strong>
      <p>{shipping ? t.shippingIntro : t.pickupIntro}</p>
    </header>
    <FanSurface className={styles.formSurface}>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <div className={styles.fields}>
          {field("name", t.name, { required: true, maxLength: 120, autoComplete: "name" })}
          {field("phone", t.phone, { required: true, minLength: 7, maxLength: 40, type: "tel", autoComplete: "tel", inputMode: "tel" })}
          {shipping ? <>
            {field("postalCode", t.postalCode, { required: true, maxLength: 20, autoComplete: "postal-code" })}
            {field("address1", t.address1, { required: true, maxLength: 300, autoComplete: "address-line1" })}
            {field("address2", t.address2, { maxLength: 300, autoComplete: "address-line2" })}
          </> : null}
        </div>
        <section className={styles.privacy} aria-labelledby="recipient-privacy-heading">
          <ShieldCheck aria-hidden="true" />
          <div><h2 id="recipient-privacy-heading">{locale === "ko" ? "개인정보 수집·이용" : "Collection and use of personal information"}</h2><p>{t.privacy} <a href={withLocalePath("/privacy", locale)}>{t.privacyLink}</a></p></div>
        </section>
        <label className={styles.consent} htmlFor="consented">
          <input id="consented" ref={(node) => { fieldRefs.current.consented = node; }} type="checkbox" checked={draft.consented} disabled={busy || locked} required aria-invalid={Boolean(errors.consented)} aria-describedby={errors.consented ? "consented-error" : undefined} onChange={(event) => updateField("consented", event.target.checked)} />
          <span>{t.consent}</span>
        </label>
        {errors.consented ? <p className={styles.error} id="consented-error">{errors.consented}</p> : null}
        {message ? <p className={locked ? styles.warning : styles.message} role={locked ? "alert" : "status"}>{locked ? <><strong>{t.confirmTitle}</strong><span>{message}</span></> : message}</p> : null}
        <div className={styles.actions}>
          {locked
            ? <FanAction variant="primary" type="button" onClick={() => void confirmStatus()}>{t.checkStatus}</FanAction>
            : <FanAction variant="primary" type="submit" disabled={busy} ariaBusy={busy}>{submitPhase === "posting" ? t.submitting : submitPhase === "reconciling" ? t.reconciling : t.submit}</FanAction>}
          <FanAction href={withLocalePath("/my", locale)}>{t.backMy}</FanAction>
        </div>
      </form>
    </FanSurface>
  </div>);
}
