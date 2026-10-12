"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ArrowRight, Check, ChevronRight, ShieldCheck, X } from "lucide-react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import { rememberOverlayTrigger } from "@/components/ui/overlay/focus-return";
import { ResidentRegistrationNumberField } from "./resident-registration-number-field";
import styles from "./byus-day-screen.module.css";

const ACCESS_CONTROL_URL = "https://home.army.mil/humphreys/about/garrison/DES/physical-security/access-control";

const copy = {
  ko: {
    securityTitle:"SECURITY NOTICE", entryRequired:"미군기지 출입 신청을 위해 주민등록번호 제출이 필요합니다.", entryPurpose:"제출 정보는 출입 승인 및 신원 확인 목적으로만 사용됩니다.",
    accessPolicy:"출입 절차 참고: 주한미군 기지 출입통제 지침(USFKI 5200.08A CH1)", accessLink:<>출입절차 <strong>규정</strong> · 새 탭에서 보기</>,
    registrationPrivacyTitle:"[필수] 주민등록번호 처리 안내", registrationPrivacyItems:"처리항목: 주민등록번호", registrationPrivacyPurpose:"이용목적: 미군기지 출입자 확인 및 출입명단 제출", registrationPrivacyRetention:<>보유기간: 출입 절차 완료 후 지체 없이 <strong>파기합니다.</strong></>,
    privacyRecipient:"출입명단 제공처: 용산미군기지 출입 담당부서", registrationRefusal:"정보를 제출하지 않으면 기지 출입 신청을 진행할 수 없습니다.",
    formTitle:"스태프 참가 신청", formDescription:"아래 정보를 남겨 주세요. 행사와 출입 안내를 전해 드릴게요.",
    required:"모든 항목 필수", fieldRequired:"필수", koreanName:"한글 이름", englishName:"영어 이름", phone:"휴대폰 번호", phoneHelp:"해외 번호는 국가번호부터 입력해 주세요.",
    residentRegistrationNumber:"주민등록번호", registrationNumberHelp:"출입 승인 및 신원 확인을 위한 필수정보입니다. 앞 7자리만 표시되며, 눈 아이콘으로 전체 번호를 확인할 수 있습니다.",
    registrationPartLabels:["주민등록번호 앞 6자리", "주민등록번호 뒤 첫 자리", "주민등록번호 뒤 나머지 6자리"], showRegistrationNumber:"주민등록번호 전체 보기", hideRegistrationNumber:"주민등록번호 뒷자리 가리기",
    affiliation:"소속", occupation:"직책", email:"이메일", nationality:"국적", chooseCountry:"국적을 선택해 주세요",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"회사 또는 단체명", occupationPlaceholder:"예: 대표, 팀장, 프로듀서",
    consent:"개인정보 수집·이용에 동의합니다.", privacyTitle:"일반 개인정보 수집·이용 안내", privacyController:"개인정보 처리자: (주)셀리랩", closePrivacy:"닫기",
    privacyPurpose:"목적: 참가 신청 접수, 행사 안내, 기지 출입 명단 제출",
    privacyItems:"항목: 한글·영어 이름, 휴대폰 번호, 소속, 직책, 이메일, 국적",
    privacyRetention:"보유·파기: 일반 개인정보는 행사 익일인 2026년 10월 23일에 파기합니다.",
    privacyRefusal:"동의를 거부할 수 있으며, 동의하지 않으면 참가 신청을 접수할 수 없습니다.",
    submit:"참가 신청하기", submitting:"신청을 접수하고 있어요…", secure:"신청 정보는 행사 운영을 위해서만 사용합니다.",
    requiredError:"이 항목을 입력해 주세요.", emailError:"이메일 주소를 확인해 주세요.", phoneError:"휴대폰 번호를 확인해 주세요.", registrationNumberError:"주민등록번호 13자리를 확인해 주세요.", invalidError:"입력한 정보를 확인해 주세요.",
    unavailable:"신청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.", rateLimited:"신청 요청이 많아요. 잠시 후 다시 시도해 주세요.", closed:"참가 신청이 마감되었습니다.",
    successTitle:"신청이 접수되었어요.", successDescription:"남겨 주신 연락처로 행사와 기지 출입 안내를 전해 드릴게요.",
    successNote:"신청 접수는 참가 및 기지 출입 확정을 의미하지 않습니다.", return:"kyaa 둘러보기", footer:"라이브 팬덤 플랫폼",
  },
  en: {
    securityTitle:"SECURITY NOTICE", entryRequired:"A Korean resident registration number is required to apply for access to the U.S. military base.", entryPurpose:"The information is used only for access approval and identity verification.",
    accessPolicy:"Access procedure reference: USFKI 5200.08A CH1", accessLink:<>Installation Access <strong>Policy</strong> · Opens in a new tab</>,
    registrationPrivacyTitle:"[Required] Resident registration number processing", registrationPrivacyItems:"Information processed: Korean resident registration number", registrationPrivacyPurpose:"Purpose: verifying base visitors and submitting the base entry list", registrationPrivacyRetention:<>Retention: <strong>deleted</strong> without delay after the access procedure is complete</>,
    privacyRecipient:"Base entry list recipient: Yongsan Garrison access control office", registrationRefusal:"We cannot submit your base access application without this information.",
    formTitle:"Staff RSVP", formDescription:"Leave your details below. We’ll be in touch with event and entry information.",
    required:"All fields required", fieldRequired:"Required", koreanName:"Korean name", englishName:"English name", phone:"Mobile number", phoneHelp:"Include your country code for numbers outside Korea.",
    residentRegistrationNumber:"Resident registration number", registrationNumberHelp:"Required for base access approval and identity verification. Only the first 7 digits are shown. Use the eye icon to check the full number.",
    registrationPartLabels:["First 6 digits of registration number", "First digit after the hyphen", "Last 6 digits of registration number"], showRegistrationNumber:"Show full registration number", hideRegistrationNumber:"Hide last 6 digits of registration number",
    affiliation:"Company / organization", occupation:"Job title", email:"Email", nationality:"Nationality", chooseCountry:"Select your nationality",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"Company or organization", occupationPlaceholder:"e.g. CEO, Producer",
    consent:"I agree to the collection and use of my personal information.", privacyTitle:"Personal information collection and use", privacyController:"Personal information controller: Sallylab Co., Ltd.", closePrivacy:"Close",
    privacyPurpose:"Purpose: RSVP processing, event communication, and submission of the base entry list",
    privacyItems:"Information: Korean and English names, mobile number, company, job title, email, and nationality",
    privacyRetention:"Retention and deletion: general personal information will be deleted on October 23, 2026, the day after the event.",
    privacyRefusal:"You may decline consent. We cannot process your RSVP without it.",
    submit:"Send my RSVP", submitting:"Sending your RSVP…", secure:"Your details are used only to organize this event.",
    requiredError:"Please fill in this field.", emailError:"Please check your email address.", phoneError:"Please check your mobile number.", registrationNumberError:"Please check your 13-digit registration number.", invalidError:"Please check your details.",
    unavailable:"We couldn’t receive your RSVP. Please try again shortly.", rateLimited:"There are too many requests. Please try again later.", closed:"RSVPs are now closed.",
    successTitle:"Your RSVP has been received.", successDescription:"We’ll contact you with event details and base entry instructions.",
    successNote:"An RSVP does not confirm attendance or access to the base.", return:"Explore kyaa", footer:"Live fandom platform",
  },
} as const;

type FieldName = "koreanName" | "englishName" | "phone" | "residentRegistrationNumber" | "affiliation" | "occupation" | "email" | "nationality" | "consent";


export function StaffRsvpForm({ locale, countries }: { locale: "ko" | "en"; countries: readonly { code: string; name: string }[] }) {
  const t = copy[locale];
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [privacyDialog, setPrivacyDialog] = useState<"general" | "registration" | null>(null);
  const closePrivacyRef = useRef<HTMLButtonElement>(null);
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (accepted) successRef.current?.focus(); }, [accepted]);


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const fieldErrors: Partial<Record<FieldName,string>> = {};
    for (const element of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")) {
      if (!element.validity.valid || (element.type !== "checkbox" && !element.value.trim())) fieldErrors[element.name as FieldName] = element.validity.typeMismatch ? t.emailError : element.validity.patternMismatch ? t.registrationNumberError : t.requiredError;
    }
    const phone = parsePhoneNumberFromString(String(data.get("phone") ?? "").trim(), { defaultCountry:"KR", extract:false });
    if (!phone?.isValid() || phone.ext) fieldErrors.phone = t.phoneError;
    if (!/^\d{6}-\d{7}$/.test(String(data.get("residentRegistrationNumber") ?? ""))) fieldErrors.residentRegistrationNumber = t.registrationNumberError;
    setErrors(fieldErrors);
    setFailure("");
    if (Object.keys(fieldErrors).length) {
      const firstError = Object.keys(fieldErrors)[0];
      form.querySelector<HTMLElement>(firstError === "residentRegistrationNumber" ? "#rsvp-residentRegistrationNumber" : '[name="' + firstError + '"]')?.focus();
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
      const response = await fetch("/api/byus-day/rsvp/staff", {
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

  function field(name: Exclude<FieldName,"nationality" | "consent" | "residentRegistrationNumber">, options: { type?:"email" | "tel"; placeholder?:string; autoComplete?:string; maxLength?:number } = {}) {
    const error = errors[name];
    return <div className={styles.field}>
      <label htmlFor={"rsvp-" + name}>{t[name]}<span className={styles.fieldRequired} aria-hidden="true">{t.fieldRequired}</span></label>
      <input id={"rsvp-" + name} name={name} required maxLength={options.maxLength ?? 80} type={options.type ?? "text"}
        placeholder={options.placeholder} autoComplete={options.autoComplete ?? "off"} aria-invalid={error ? true : undefined}
        aria-describedby={[error ? "rsvp-" + name + "-error" : "", name === "phone" ? "rsvp-phone-help" : ""].filter(Boolean).join(" ") || undefined} />
      {name === "phone" && <p id="rsvp-phone-help" className={styles.hint}>{t.phoneHelp}</p>}
      {error && <p id={"rsvp-" + name + "-error"} className={styles.fieldError}>{error}</p>}
    </div>;
  }

  return <>
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
            <section className={styles.securityNotice} aria-labelledby="entry-security-title">
              <h3 id="entry-security-title"><ShieldCheck size={18} aria-hidden="true" />{t.securityTitle}</h3>
              <p>{t.entryRequired}</p><p>{t.entryPurpose}</p>
              <p className={styles.policyReference}>{t.accessPolicy}</p>
              <a href={ACCESS_CONTROL_URL} target="_blank" rel="noopener noreferrer"><span>{t.accessLink}</span><ArrowRight size={16} aria-hidden="true" /></a>
            </section>
            <ResidentRegistrationNumberField label={t.residentRegistrationNumber} requiredLabel={t.fieldRequired} partLabels={t.registrationPartLabels as [string, string, string]} showLabel={t.showRegistrationNumber} hideLabel={t.hideRegistrationNumber} help={t.registrationNumberHelp} error={errors.residentRegistrationNumber} />
            <div className={styles.pair}>{field("affiliation",{ placeholder:t.affiliationPlaceholder, maxLength:120 })}{field("occupation",{ placeholder:t.occupationPlaceholder, maxLength:120 })}</div>
            {field("email",{ type:"email", placeholder:"you@example.com", autoComplete:"email", maxLength:254 })}
            <div className={styles.field}><label htmlFor="rsvp-nationality">{t.nationality}<span className={styles.fieldRequired} aria-hidden="true">{t.fieldRequired}</span></label>
              <select id="rsvp-nationality" name="nationality" required defaultValue="KR" aria-invalid={errors.nationality ? true : undefined} aria-describedby={errors.nationality ? "rsvp-nationality-error" : undefined}>
                <option value="" disabled>{t.chooseCountry}</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>{errors.nationality && <p id="rsvp-nationality-error" className={styles.fieldError}>{errors.nationality}</p>}
            </div>
            <div className={styles.privacy}>
              <label className={styles.consent}><input type="checkbox" name="consent" required aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "rsvp-consent-error" : undefined} /><span>{t.consent}<span className={styles.fieldRequired} aria-hidden="true">{t.fieldRequired}</span></span></label>
              {errors.consent && <p id="rsvp-consent-error" className={styles.fieldError}>{errors.consent}</p>}
              <button type="button" className={styles.privacyLink} aria-haspopup="dialog" onClick={event => { rememberOverlayTrigger(event.currentTarget); setPrivacyDialog("general"); }}>{t.privacyTitle}<ChevronRight size={18} aria-hidden="true" /></button>
              <button type="button" className={styles.privacyLink} aria-haspopup="dialog" onClick={event => { rememberOverlayTrigger(event.currentTarget); setPrivacyDialog("registration"); }}>{t.registrationPrivacyTitle}<ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </fieldset>
          {failure && <p className={styles.error} role="alert">{failure}</p>}
          <div className={styles.errorAnnouncement} aria-live="polite">{Object.keys(errors).length > 0 ? t.invalidError : ""}</div>
          <FanAction type="submit" variant="neutral" fullWidth disabled={pending} ariaBusy={pending} className={styles.submit} trailingIcon={!pending ? <ArrowRight size={20} /> : undefined}>{pending ? t.submitting : t.submit}</FanAction>
          <p className={styles.security}><ShieldCheck size={16} aria-hidden="true" />{t.secure}</p>
        </form>}
    <AccessibleOverlay open={privacyDialog !== null} onClose={() => setPrivacyDialog(null)} labelledBy="rsvp-privacy-dialog-title" initialFocusRef={closePrivacyRef} backdropClassName={styles.privacyBackdrop} contentClassName={styles.privacyDialog} contentAs="section">
      <div className={styles.privacyDialogHeading}><h2 id="rsvp-privacy-dialog-title">{privacyDialog === "general" ? t.privacyTitle : t.registrationPrivacyTitle}</h2><button ref={closePrivacyRef} type="button" aria-label={t.closePrivacy} onClick={() => setPrivacyDialog(null)}><X size={20} aria-hidden="true" /></button></div>
      <div className={styles.privacyCopy}>
        <p>{t.privacyController}</p>
        <ul>
          {privacyDialog === "general" ? <><li>{t.privacyPurpose}</li><li>{t.privacyItems}</li></> : <><li>{t.registrationPrivacyItems}</li><li>{t.registrationPrivacyPurpose}</li></>}
          <li>{t.privacyRecipient}</li><li>{privacyDialog === "general" ? t.privacyRetention : t.registrationPrivacyRetention}</li>
        </ul>
        <p>{privacyDialog === "general" ? t.privacyRefusal : t.registrationRefusal}</p>
        {privacyDialog === "registration" && <p>{t.accessPolicy}</p>}
      </div>
    </AccessibleOverlay>
  </>;
}
