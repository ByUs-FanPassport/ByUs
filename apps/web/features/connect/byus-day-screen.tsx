"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ArrowLeft, ArrowRight, Check, MapPin, ShieldCheck } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./byus-day-screen.module.css";

const copy = {
  ko: {
    back:"ByUs", language:"언어 선택", skip:"참가 신청으로 이동", invitation:"초대합니다",
    headline:"ByUs의 다음 소식을\n함께 나누는 저녁.",
    introduction:"라이브와 팬덤, 그리고 함께할 사람들.\n새로운 소식을 나누고 편안하게 이야기를 이어가세요.",
    date:"2026년 10월 22일 목요일", timezone:"한국 시간 · KST", evening:"함께하는 저녁", program:"본행사", afterparty:"뒷풀이",
    venue:"장소", location:"서울 용산 · 미군기지 내", venueNote:"기지 출입 안내는 신청 후 별도로 전해 드립니다.",
    formTitle:"참가 신청", formDescription:"아래 정보를 남겨 주세요. 행사와 출입 안내를 전해 드릴게요.",
    required:"모든 항목 필수", koreanName:"한글 이름", englishName:"영어 이름", phone:"휴대폰 번호", phoneHelp:"해외 번호는 국가번호부터 입력해 주세요.",
    residentRegistrationNumber:"주민등록번호", registrationNumberHelp:"미군기지 출입 명단 제출에 사용합니다.",
    affiliation:"소속", occupation:"직업", email:"이메일", nationality:"국적", chooseCountry:"국적을 선택해 주세요",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"회사 또는 단체명", occupationPlaceholder:"직업 또는 맡고 있는 일",
    consent:"개인정보 수집·이용에 동의합니다.", privacyTitle:"개인정보 안내", privacyController:"처리자: 샐리랩(ByUs)",
    privacyPurpose:"목적: 참가 신청 접수, 행사 안내, 기지 출입 명단 제출",
    privacyItems:"항목: 한글·영어 이름, 휴대폰 번호, 주민등록번호, 소속, 직업, 이메일, 국적",
    privacyRetention:"보관 기간: 행사 종료 후 1개월. 이후 운영자가 삭제합니다.",
    privacyRefusal:"동의를 거부할 수 있으며, 동의하지 않으면 참가 신청을 접수할 수 없습니다.",
    submit:"참가 신청하기", submitting:"신청을 접수하고 있어요…", secure:"신청 정보는 행사 운영을 위해서만 사용합니다.",
    requiredError:"이 항목을 입력해 주세요.", emailError:"이메일 주소를 확인해 주세요.", phoneError:"휴대폰 번호를 확인해 주세요.", registrationNumberError:"주민등록번호 13자리를 확인해 주세요.", invalidError:"입력한 정보를 확인해 주세요.",
    unavailable:"신청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.", rateLimited:"신청 요청이 많아요. 잠시 후 다시 시도해 주세요.", closed:"참가 신청이 마감되었습니다.",
    successTitle:"신청이 접수되었어요.", successDescription:"남겨 주신 연락처로 행사와 기지 출입 안내를 전해 드릴게요.",
    successNote:"신청 접수는 참가 및 기지 출입 확정을 의미하지 않습니다.", return:"ByUs 둘러보기", footer:"라이브 팬덤 플랫폼",
  },
  en: {
    back:"ByUs", language:"Choose language", skip:"Skip to RSVP", invitation:"You’re invited",
    headline:"An evening for\nwhat’s next at ByUs.",
    introduction:"Live, fandom, and the people behind it.\nJoin us for news from ByUs and conversations that continue into the night.",
    date:"Thursday, October 22, 2026", timezone:"Seoul time · KST", evening:"The evening", program:"Main event", afterparty:"After-party",
    venue:"Venue", location:"Yongsan, Seoul · on the U.S. military base", venueNote:"We’ll share base entry instructions separately after you register.",
    formTitle:"RSVP", formDescription:"Leave your details below. We’ll be in touch with event and entry information.",
    required:"All fields required", koreanName:"Korean name", englishName:"English name", phone:"Mobile number", phoneHelp:"Include your country code for numbers outside Korea.",
    residentRegistrationNumber:"Resident registration number", registrationNumberHelp:"Used for the U.S. military base entry list.",
    affiliation:"Company / organization", occupation:"Occupation / role", email:"Email", nationality:"Nationality", chooseCountry:"Select your nationality",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"Company or organization", occupationPlaceholder:"Your occupation or role",
    consent:"I agree to the collection and use of my personal information.", privacyTitle:"Privacy details", privacyController:"Controller: Sallylab (ByUs)",
    privacyPurpose:"Purpose: RSVP processing, event communication, and submission of the base entry list",
    privacyItems:"Information: Korean and English names, mobile number, resident registration number, company, occupation, email, and nationality",
    privacyRetention:"Retention: one month after the event ends. The organizer will then delete the information.",
    privacyRefusal:"You may decline consent. We cannot process your RSVP without it.",
    submit:"Send my RSVP", submitting:"Sending your RSVP…", secure:"Your details are used only to organize this event.",
    requiredError:"Please fill in this field.", emailError:"Please check your email address.", phoneError:"Please check your mobile number.", registrationNumberError:"Please check your 13-digit registration number.", invalidError:"Please check your details.",
    unavailable:"We couldn’t receive your RSVP. Please try again shortly.", rateLimited:"There are too many requests. Please try again later.", closed:"RSVPs are now closed.",
    successTitle:"Your RSVP has been received.", successDescription:"We’ll contact you with event details and base entry instructions.",
    successNote:"An RSVP does not confirm attendance or access to the base.", return:"Explore ByUs", footer:"Live fandom platform",
  },
} as const;

type FieldName = "koreanName" | "englishName" | "phone" | "residentRegistrationNumber" | "affiliation" | "occupation" | "email" | "nationality" | "consent";

export function ByusDayScreen({ countries }: { countries: readonly { code: string; name: string }[] }) {
  const { locale: appLocale } = useAppLocale();
  const locale = appLocale === "ko" ? "ko" : "en";
  const t = copy[locale];
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (accepted) successRef.current?.focus(); }, [accepted]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const fieldErrors: Partial<Record<FieldName,string>> = {};
    for (const element of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      if (!element.validity.valid || (element.type !== "checkbox" && !element.value.trim())) fieldErrors[element.name as FieldName] = element.validity.typeMismatch ? t.emailError : element.validity.patternMismatch ? t.registrationNumberError : t.requiredError;
    }
    const phone = parsePhoneNumberFromString(String(data.get("phone") ?? "").trim(), { defaultCountry:"KR", extract:false });
    if (!phone?.isValid() || phone.ext) fieldErrors.phone = t.phoneError;
    setErrors(fieldErrors);
    setFailure("");
    if (Object.keys(fieldErrors).length) {
      form.querySelector<HTMLElement>('[name="' + Object.keys(fieldErrors)[0] + '"]')?.focus();
      return;
    }
    const values = {
      locale, koreanName:String(data.get("koreanName")).trim(), englishName:String(data.get("englishName")).trim(),
      phone:phone!.number, residentRegistrationNumber:String(data.get("residentRegistrationNumber")).trim(), affiliation:String(data.get("affiliation")).trim(), occupation:String(data.get("occupation")).trim(),
      email:String(data.get("email")).trim(), nationality:String(data.get("nationality")), consent:true,
    };
    const payload = JSON.stringify(values);
    if (submission.current?.payload !== payload) submission.current = { key:crypto.randomUUID(), payload };
    setPending(true);
    try {
      const response = await fetch("/api/byus-day/rsvp", {
        method:"POST", headers:{ "content-type":"application/json" },
        body:JSON.stringify({ ...values, idempotencyKey:submission.current!.key }), signal:AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || result.status !== "accepted") {
        const code = result.error?.code;
        setFailure(code === "RSVP_CLOSED" ? t.closed : code === "RSVP_RATE_LIMITED" ? t.rateLimited : code === "RSVP_INVALID" ? t.invalidError : t.unavailable);
        return;
      }
      submission.current = null;
      form.reset();
      setAccepted(true);
    } catch { setFailure(t.unavailable); }
    finally { setPending(false); }
  }

  function field(name: Exclude<FieldName,"nationality" | "consent">, options: { type?:"email" | "tel" | "password"; placeholder?:string; autoComplete?:string; maxLength?:number; inputMode?:"numeric"; pattern?:string } = {}) {
    const error = errors[name];
    return <div className={styles.field}>
      <label htmlFor={"rsvp-" + name}>{t[name]}</label>
      <input id={"rsvp-" + name} name={name} required maxLength={options.maxLength ?? 80} type={options.type ?? "text"}
        placeholder={options.placeholder} autoComplete={options.autoComplete ?? "off"} inputMode={options.inputMode} pattern={options.pattern} aria-invalid={error ? true : undefined}
        aria-describedby={[error ? "rsvp-" + name + "-error" : "", name === "phone" ? "rsvp-phone-help" : "", name === "residentRegistrationNumber" ? "rsvp-registration-number-help" : ""].filter(Boolean).join(" ") || undefined} />
      {name === "phone" && <p id="rsvp-phone-help" className={styles.hint}>{t.phoneHelp}</p>}
      {name === "residentRegistrationNumber" && <p id="rsvp-registration-number-help" className={styles.hint}>{t.registrationNumberHelp}</p>}
      {error && <p id={"rsvp-" + name + "-error"} className={styles.fieldError}>{error}</p>}
    </div>;
  }

  return <div className={styles.page} lang={locale}>
    <a className={styles.skipLink} href="#rsvp">{t.skip}</a>
    <header className={styles.header}>
      <Link href={`/connect?locale=${locale}#links`} className={styles.back}><ArrowLeft size={18} aria-hidden="true" />{t.back}</Link>
      <span className={styles.headerCaption}>A BYUS GATHERING</span>
      <a href="#rsvp" className={styles.headerRsvp}>RSVP <ArrowRight size={16} aria-hidden="true" /></a>
      <nav className={styles.languages} aria-label={t.language}>
        <Link href="/connect/byus-day?locale=ko" replace aria-current={locale === "ko" ? "true" : undefined} aria-label="한국어" lang="ko">KO</Link>
        <Link href="/connect/byus-day?locale=en" replace aria-current={locale === "en" ? "true" : undefined} aria-label="English" lang="en">EN</Link>
      </nav>
    </header>
    <main className={styles.canvas}>
      <section className={styles.invitation} aria-labelledby="event-title">
        <div className={styles.invitationTop}><p className={styles.eyebrow}>{t.invitation}</p><span aria-hidden="true">✳</span></div>
        <h1 id="event-title" className={styles.title}>BYUS <span>DAY</span></h1>
        <p className={styles.headline}>{t.headline}</p>
        <p className={styles.introduction}>{t.introduction}</p>
        <div className={styles.artwork} aria-hidden="true">
          <Image src="/images/connect/byus-day/poster-en.webp" alt="" width={1024} height={1536} sizes="(min-width: 1024px) 580px, 100vw" loading="eager" />
        </div>
        <div className={styles.dateRow}><div><p className={styles.eyebrow}>{t.timezone}</p><time dateTime="2026-10-22" className={styles.date}>2026.10.22</time><p className={styles.day}>{t.date}</p></div><span className={styles.seal} aria-hidden="true">BYUS<br /><b>22</b><br />OCTOBER</span></div>
        <section className={styles.schedule} aria-labelledby="schedule-title">
          <h2 id="schedule-title">{t.evening}</h2>
          <dl><div><dt>{t.program}</dt><dd>18:30 <span>—</span> 21:30</dd></div><div><dt>{t.afterparty}</dt><dd>21:30 <span>—</span> 24:00</dd></div></dl>
        </section>
        <section className={styles.venue} aria-labelledby="venue-title"><MapPin size={22} aria-hidden="true" /><div>
          <h2 id="venue-title">{t.venue}</h2><p className={styles.venueName}>Dragon Hill Lodge <span>(DHL)</span></p><p>{t.location}</p><p className={styles.venueNote}>{t.venueNote}</p>
        </div></section>
      </section>
      <section id="rsvp" className={styles.registration} aria-labelledby="rsvp-title" tabIndex={-1}>
        <div className={styles.formHeading}><p className={styles.eyebrow}>RSVP · BYUS DAY</p><h2 id="rsvp-title">{t.formTitle}</h2><p>{t.formDescription}</p></div>
        {accepted ? <div className={styles.success} role="status">
          <span className={styles.successMark}><Check size={30} aria-hidden="true" /></span>
          <h3 ref={successRef} tabIndex={-1}>{t.successTitle}</h3><p>{t.successDescription}</p><p className={styles.hint}>{t.successNote}</p>
          <FanAction href={"/?locale=" + locale} variant="neutral" fullWidth className={styles.return}>{t.return}</FanAction>
        </div> : <form onSubmit={submit} noValidate aria-busy={pending}>
          <p className={styles.required}>{t.required}</p>
          <fieldset disabled={pending} className={styles.fields}>
            <legend className={styles.srOnly}>{t.formTitle}</legend>
            <div className={styles.pair}>{field("koreanName",{ placeholder:t.koreanNamePlaceholder })}{field("englishName",{ placeholder:t.englishNamePlaceholder })}</div>
            {field("phone",{ type:"tel", placeholder:"+82 10-1234-5678", autoComplete:"tel", maxLength:30 })}
            {field("residentRegistrationNumber",{ type:"password", placeholder:"000000-0000000", inputMode:"numeric", pattern:"[0-9]{6}-?[0-9]{7}", maxLength:14 })}
            <div className={styles.pair}>{field("affiliation",{ placeholder:t.affiliationPlaceholder, maxLength:120 })}{field("occupation",{ placeholder:t.occupationPlaceholder, maxLength:120 })}</div>
            {field("email",{ type:"email", placeholder:"you@example.com", autoComplete:"email", maxLength:254 })}
            <div className={styles.field}><label htmlFor="rsvp-nationality">{t.nationality}</label>
              <select id="rsvp-nationality" name="nationality" required defaultValue="" aria-invalid={errors.nationality ? true : undefined} aria-describedby={errors.nationality ? "rsvp-nationality-error" : undefined}>
                <option value="" disabled>{t.chooseCountry}</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>{errors.nationality && <p id="rsvp-nationality-error" className={styles.fieldError}>{errors.nationality}</p>}
            </div>
            <div className={styles.privacy}>
              <label className={styles.consent}><input type="checkbox" name="consent" required aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "rsvp-consent-error" : undefined} /><span>{t.consent}</span></label>
              {errors.consent && <p id="rsvp-consent-error" className={styles.fieldError}>{errors.consent}</p>}
              <details><summary>{t.privacyTitle}</summary><div className={styles.privacyCopy}><p>{t.privacyController}</p><p>{t.privacyPurpose}</p><p>{t.privacyItems}</p><p>{t.privacyRetention}</p><p>{t.privacyRefusal}</p></div></details>
            </div>
          </fieldset>
          {failure && <p className={styles.error} role="alert">{failure}</p>}
          <div className={styles.errorAnnouncement} aria-live="polite">{Object.keys(errors).length > 0 ? t.invalidError : ""}</div>
          <FanAction type="submit" variant="neutral" fullWidth disabled={pending} ariaBusy={pending} className={styles.submit} trailingIcon={!pending ? <ArrowRight size={20} /> : undefined}>{pending ? t.submitting : t.submit}</FanAction>
          <p className={styles.security}><ShieldCheck size={16} aria-hidden="true" />{t.secure}</p>
        </form>}
      </section>
    </main>
    <footer className={styles.footer}><span className={styles.wordmark}>ByUs</span><span>{t.footer}</span><span>SEOUL, 2026</span></footer>
  </div>;
}
