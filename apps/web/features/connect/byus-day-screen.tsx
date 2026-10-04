"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, MapPin, ShieldCheck, X } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import { rememberOverlayTrigger } from "@/components/ui/overlay/focus-return";
import { ResidentRegistrationNumberField } from "./resident-registration-number-field";
import styles from "./byus-day-screen.module.css";

const ACCESS_CONTROL_URL = "https://home.army.mil/humphreys/about/garrison/DES/physical-security/access-control";
const DIRECTIONS_URL = "https://www.dragonhilllodge.com/your-stay/getting-here";
const GATE_ADDRESS = "서울 용산구 용산동4가 1-10";
const NAVER_MAP_URL = `https://map.naver.com/p/search/${encodeURIComponent(GATE_ADDRESS)}`;
const GOOGLE_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(GATE_ADDRESS)}`;

const copy = {
  ko: {
    back:"ByUs", language:"언어 선택", skip:"참가 신청으로 이동", invitation:"초대합니다",
    headline:"엔터테인먼트와 기술이 만나는\nEnter × Tech의 밤.",
    introduction:"ByUs Day는 엔터테인먼트와 기술의 경계를 넘어 새로운 가능성과 협업을 연결하는 자리입니다.\n쇼케이스와 대담, 네트워킹을 통해 새로운 아이디어와 사람을 만나보세요.",
    posterAlt:"ByUs Day Enter × Tech 한글 행사 포스터", posterLink:"한글 포스터 · 새 탭에서 크게 보기",
    date:"2026년 10월 22일 목요일 18:30 시작", timezone:"한국 시간 · KST", evening:"함께하는 저녁", program:"본행사", afterparty:"뒷풀이", scheduleNote:"뒷풀이는 본행사에 이어 같은 호텔 1층 펍에서 진행합니다.",
    programTitle:"본행사 프로그램", programSteps:["오프닝", "식사(코스요리)", "세션 및 Q&A", "럭키드로우", "BYUS LIVE"], afterpartyProgram:"네트워킹·래플",
    securityTitle:"SECURITY NOTICE", entryRequired:"미군기지 출입 신청을 위해 주민등록번호 제출이 필요합니다.", entryPurpose:"제출 정보는 출입 승인 및 신원 확인 목적으로만 사용됩니다.",
    accessPolicy:"출입 절차 참고: 주한미군 기지 출입통제 지침(USFKI 5200.08A CH1)", accessLink:<>출입절차 <strong>규정</strong> · 새 탭에서 보기</>,
    registrationPrivacyTitle:"[필수] 주민등록번호 처리 안내", registrationPrivacyItems:"처리항목: 주민등록번호", registrationPrivacyPurpose:"이용목적: 미군기지 출입자 확인 및 출입명단 제출", registrationPrivacyRetention:<>보유기간: 출입 절차 완료 후 지체 없이 <strong>파기합니다.</strong></>,
    privacyRecipient:"출입명단 제공처: 용산미군기지 출입 담당부서", registrationRefusal:"정보를 제출하지 않으면 기지 출입 신청을 진행할 수 없습니다.",
    venue:"장소", location:"서울 용산 · 미군기지 내", venueNote:"기지 출입 안내는 신청 후 별도로 전해 드립니다.",
    vehicleEntry:"미군기지는 등록된 차량만 출입할 수 있습니다.", vehicleRequest:"차량 없이 방문해 주시길 부탁드립니다.", vehicleApology:"불편을 드려 죄송합니다.",
    enlargeMap:"약도 크게 보기", mapTitle:"Gate 1에서 호텔까지", mapDescription:"삼각지역 13번 출구와 녹사평역 4번 출구 사이, 고가도로 옆 보행로로 Gate 1에 접근합니다. 출입 확인 후 안내된 보행로를 따라 드래곤힐 로지로 이동합니다.", mapCaption:"위치 참고용 약도 · 실제 거리와 비례하지 않습니다.", walkingTitle:"도보 입장 순서", walkingSteps:["고가도로 바로 옆 인도를 이용해 Gate 1 초소로 이동합니다.", "출입 확인 후 인도를 따라 왼쪽으로 이동합니다.", "주차장을 대각선으로 지나 호텔에 도착합니다."], alternateStation:"녹사평역 4번 출구(6호선)에서도 Gate 1 방향으로 이동할 수 있습니다.",
    arrivalTitle:"오시는 길", arrivalIntro:"대중교통이나 택시를 이용해 주세요. 아래는 호텔 공식 안내에 따른 Gate 1 주변 경로입니다.",
    routeStation:"삼각지역 13번 출구 · 4·6호선", routeWalk:"도보 약 5분", routeGate:"용산미군기지 Gate 1 주변", gateAddress:"서울 용산구 용산동4가 1-10",
    taxiNote:"택시를 이용하시면 위 주소의 Gate 1 주변에서 내려 주세요.", mapIntro:"출입구 주변 참고 위치를 지도에서 확인하세요.", naverMap:"네이버 지도", googleMap:"Google Maps", newTab:"새 탭에서 보기",
    arrivalNote:"위 경로는 호텔의 일반 방문 안내입니다. 행사 출입구·집합 위치와 입장 절차는 신청자에게 별도로 안내합니다.", officialDirections:"호텔 공식 길 안내",
    formTitle:"참가 신청", formDescription:"아래 정보를 남겨 주세요. 행사와 출입 안내를 전해 드릴게요.",
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
    successNote:"신청 접수는 참가 및 기지 출입 확정을 의미하지 않습니다.", return:"ByUs 둘러보기", footer:"라이브 팬덤 플랫폼",
  },
  en: {
    back:"ByUs", language:"Choose language", skip:"Skip to RSVP", invitation:"You’re invited",
    headline:"Where entertainment meets technology.\nEnter × Tech at ByUs Day.",
    introduction:"ByUs Day brings people together across entertainment and technology to explore new possibilities and collaborations.\nMeet new people and ideas through showcases, fireside chats, and networking.",
    posterAlt:"ByUs Day Enter × Tech English event poster", posterLink:"English poster · Open full size in a new tab",
    date:"Thursday, October 22, 2026 · Starts at 18:30", timezone:"Seoul time · KST", evening:"The evening", program:"Main event", afterparty:"After-party", scheduleNote:"The after-party follows the main event at the pub on the hotel’s first floor.",
    programTitle:"Main event program", programSteps:["Opening", "Multi-course dinner", "Sessions & Q&A", "Lucky draw", "BYUS LIVE"], afterpartyProgram:"Networking & raffle",
    securityTitle:"SECURITY NOTICE", entryRequired:"A Korean resident registration number is required to apply for access to the U.S. military base.", entryPurpose:"The information is used only for access approval and identity verification.",
    accessPolicy:"Access procedure reference: USFKI 5200.08A CH1", accessLink:<>Installation Access <strong>Policy</strong> · Opens in a new tab</>,
    registrationPrivacyTitle:"[Required] Resident registration number processing", registrationPrivacyItems:"Information processed: Korean resident registration number", registrationPrivacyPurpose:"Purpose: verifying base visitors and submitting the base entry list", registrationPrivacyRetention:<>Retention: <strong>deleted</strong> without delay after the access procedure is complete</>,
    privacyRecipient:"Base entry list recipient: Yongsan Garrison access control office", registrationRefusal:"We cannot submit your base access application without this information.",
    venue:"Venue", location:"Yongsan, Seoul · on the U.S. military base", venueNote:"We’ll share base entry instructions separately after you register.",
    vehicleEntry:"Only registered vehicles may enter the U.S. military base.", vehicleRequest:"Please do not bring a personal vehicle.", vehicleApology:"We apologize for the inconvenience.",
    enlargeMap:"Enlarge the map", mapTitle:"From Gate 1 to the hotel", mapDescription:"Approach Gate 1 via the pedestrian path beside the overpass, between Samgakji Exit 13 and Noksapyeong Exit 4. After the entry check, follow the pedestrian path to Dragon Hill Lodge.", mapCaption:"Location guide · Not to scale.", walkingTitle:"Entering on foot", walkingSteps:["Use the pedestrian path right beside the overpass to reach Gate 1.", "After the entry check, follow the pedestrian path towards the left.", "Cross the parking lot diagonally to reach the hotel."], alternateStation:"You can also approach Gate 1 from Noksapyeong Station, Exit 4 (Line 6).",
    arrivalTitle:"Getting here", arrivalIntro:"Please use public transport or a taxi. This route to the Gate 1 area follows the hotel’s official directions.",
    routeStation:"Samgakji Station, Exit 13 · Lines 4 & 6", routeWalk:"About a 5-minute walk", routeGate:"Yongsan Garrison Gate 1 area", gateAddress:"1-10 Yongsan-dong 4-ga, Yongsan-gu, Seoul",
    taxiNote:"If taking a taxi, get off near Gate 1 at the address above.", mapIntro:"View the area around the entrance on a map.", naverMap:"Naver Map", googleMap:"Google Maps", newTab:"Opens in a new tab",
    arrivalNote:"These are the hotel’s general visitor directions. We’ll send registered guests the event entrance, meeting point, and entry instructions separately.", officialDirections:"Official hotel directions",
    formTitle:"RSVP", formDescription:"Leave your details below. We’ll be in touch with event and entry information.",
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
    successNote:"An RSVP does not confirm attendance or access to the base.", return:"Explore ByUs", footer:"Live fandom platform",
  },
} as const;

type FieldName = "koreanName" | "englishName" | "phone" | "residentRegistrationNumber" | "affiliation" | "occupation" | "email" | "nationality" | "consent";

export function ByusDayScreen({ countries }: { countries: readonly { code: string; name: string }[] }) {
  const { locale: appLocale } = useAppLocale();
  const locale = appLocale === "ko" ? "ko" : "en";
  const t = copy[locale];
  const posterSrc = `/images/connect/byus-day/poster-final-${locale}-20261004.webp`;
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [privacyDialog, setPrivacyDialog] = useState<"general" | "registration" | null>(null);
  const arrivalRef = useRef<HTMLDetailsElement>(null);
  const closePrivacyRef = useRef<HTMLButtonElement>(null);
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (accepted) successRef.current?.focus(); }, [accepted]);

  useEffect(() => {
    const revealArrival = () => {
      if (window.location.hash === "#arrival-title" && arrivalRef.current) {
        arrivalRef.current.open = true;
        document.getElementById("arrival-title")?.scrollIntoView();
      }
    };
    revealArrival();
    window.addEventListener("hashchange", revealArrival);
    return () => window.removeEventListener("hashchange", revealArrival);
  }, []);

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
        <div className={styles.dateRow}><div><p className={styles.eyebrow}>{t.timezone}</p><time dateTime="2026-10-22" className={styles.date}>2026.10.22</time></div><span className={styles.seal} aria-hidden="true">BYUS<br /><b>22</b><br />OCTOBER</span></div>
        <div className={styles.eventSummary}><p className={styles.day}>{t.date}</p><p>{locale === "ko" ? "장소: 용산미군기지 • 드래곤힐로지(DHL)" : "Venue: Yongsan Garrison • Dragon Hill Lodge (DHL)"}</p></div>
        <nav className={styles.sectionLinks} aria-label={locale === "ko" ? "행사 안내" : "Event information"}>
          <a href="#schedule-title">{t.programTitle}<ArrowRight size={16} aria-hidden="true" /></a>
          <a href="#arrival-title" onClick={() => { if (arrivalRef.current) arrivalRef.current.open = true; }}>{t.arrivalTitle}<ArrowRight size={16} aria-hidden="true" /></a>
        </nav>
        <figure className={styles.artwork}>
          <a className={styles.posterLink} href={posterSrc} target="_blank" rel="noopener noreferrer">
            <Image src={posterSrc} alt={t.posterAlt} width={1024} height={1536} sizes="(min-width: 1024px) 580px, 100vw" loading="eager" />
            <span className={styles.posterCaption}>{t.posterLink}</span>
          </a>
        </figure>

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
              <select id="rsvp-nationality" name="nationality" required defaultValue="" aria-invalid={errors.nationality ? true : undefined} aria-describedby={errors.nationality ? "rsvp-nationality-error" : undefined}>
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
      </section>
      <div className={styles.eventDetails}>
        <section className={styles.schedule} aria-labelledby="schedule-title">
          <div><h2 id="schedule-title">{t.evening}</h2>
          <dl><div><dt>{t.program}</dt><dd>18:30 <span>—</span> 21:30</dd></div><div><dt>{t.afterparty}</dt><dd>21:30 <span>—</span> 24:00</dd></div></dl></div>
          <div className={styles.program}>
            <h3>{t.programTitle}</h3>
            <ol>{t.programSteps.map(step => <li key={step}>{step}</li>)}</ol>
            <p className={styles.afterpartyProgram}>{t.afterparty} · {t.afterpartyProgram}</p>
          </div>
          <p className={styles.scheduleNote}>{t.scheduleNote}</p>
        </section>
        <section className={styles.venue} aria-labelledby="venue-title"><MapPin size={22} aria-hidden="true" /><div>
          <h2 id="venue-title">{t.venue}</h2><p className={styles.venueName}>Dragon Hill Lodge <span>(DHL)</span></p><p>{t.location}</p>
          <div className={styles.accessNotes}><p>{t.vehicleEntry}</p><p>{t.vehicleRequest}</p><p>{t.vehicleApology}</p></div>
          <p className={styles.venueNote}>{t.venueNote}</p>
        </div></section>
      </div>
        <section className={styles.arrival} aria-labelledby="arrival-title">
          <details ref={arrivalRef} className={styles.arrivalDisclosure}>
          <summary><span><h2 id="arrival-title">{t.arrivalTitle}</h2><span className={styles.arrivalSummary}>{t.routeStation} · Gate 1</span></span><span className={styles.disclosureAction}><span className={styles.whenClosed}>{locale === "ko" ? "약도·상세 안내" : "Map & directions"}</span><span className={styles.whenOpen}>{locale === "ko" ? "접기" : "Show less"}</span><ChevronDown size={20} aria-hidden="true" /></span></summary>
          <div className={styles.arrivalBody}><div>
          <p>{t.arrivalIntro}</p>
          <figure className={styles.arrivalMap}>
            <a className={styles.mapEnlargeLink} href={`/images/connect/byus-day/gate-1-directions-${locale === "ko" ? "ko" : "en"}-20261004-v2.svg`} target="_blank" rel="noopener noreferrer" aria-label={`${t.enlargeMap} · ${t.newTab}`}>
              <Image src={`/images/connect/byus-day/gate-1-directions-${locale === "ko" ? "ko" : "en"}-20261004-v2.svg`} alt={t.mapTitle} aria-describedby="arrival-map-description" width={905} height={520} sizes="(min-width: 1024px) 580px, 100vw" unoptimized />
              <span className={styles.mapEnlargeLabel}>{t.enlargeMap}<ArrowRight size={16} aria-hidden="true" /></span>
            </a>
            <span id="arrival-map-description" className={styles.srOnly}>{t.mapDescription}</span>
            <figcaption>{t.mapCaption}</figcaption>
          </figure>
          </div><div>
          <ol className={styles.arrivalRoute}><li>{t.routeStation}</li><li>{t.routeWalk}</li><li>{t.routeGate}</li></ol>
          <p>{t.alternateStation}</p>
          <div className={styles.walkingSteps}><h3>{t.walkingTitle}</h3><ol>{t.walkingSteps.map(step => <li key={step}>{step}</li>)}</ol></div>
          <p className={styles.gateAddress}>{t.gateAddress}</p>
          <p>{t.taxiNote}</p>
          <p>{t.mapIntro}</p>
          <div className={styles.mapLinks}>
            <a href={NAVER_MAP_URL} target="_blank" rel="noopener noreferrer" aria-label={`${t.naverMap} · ${t.newTab}`}>{t.naverMap}<ArrowRight size={16} aria-hidden="true" /></a>
            <a href={GOOGLE_MAP_URL} target="_blank" rel="noopener noreferrer" aria-label={`${t.googleMap} · ${t.newTab}`}>{t.googleMap}<ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <p className={styles.arrivalNote}>{t.arrivalNote}</p>
          <a className={styles.directionsSource} href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" aria-label={`${t.officialDirections} · ${t.newTab}`}>{t.officialDirections}<ArrowRight size={16} aria-hidden="true" /></a>
          </div></div>
          </details>
        </section>
    </main>
    <footer className={styles.footer}><span className={styles.wordmark}>ByUs</span><span>{t.footer}</span><span>SEOUL, 2026</span></footer>
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
  </div>;
}
