"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ArrowLeft, ArrowRight, Check, MapPin, ShieldCheck } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./byus-day-screen.module.css";

const POSTER_SRC = "/images/connect/byus-day/poster-access-policy-en-20261004.webp";
const ACCESS_CONTROL_URL = "https://home.army.mil/humphreys/about/garrison/DES/physical-security/access-control";
const DIRECTIONS_URL = "https://www.dragonhilllodge.com/your-stay/getting-here";
const GATE_ADDRESS = "서울 용산구 용산동4가 1-10";
const NAVER_MAP_URL = `https://map.naver.com/p/search/${encodeURIComponent(GATE_ADDRESS)}`;
const GOOGLE_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(GATE_ADDRESS)}`;

const copy = {
  ko: {
    back:"ByUs", language:"언어 선택", skip:"참가 신청으로 이동", invitation:"초대합니다",
    headline:"엔터테인먼트와 기술이 만나는\nEnter × Tech의 밤.",
    introduction:"ByUs Day는 엔터테인먼트와 기술의 경계를 넘어 새로운 가능성과 협업을 연결하는 자리입니다.\n쇼케이스와 파이어사이드 챗, 네트워킹을 통해 새로운 아이디어와 사람을 만나보세요.",
    posterAlt:"ByUs Day Enter × Tech 영문 행사 포스터", posterLink:"영문 포스터 · 새 탭에서 크게 보기",
    date:"2026년 10월 22일 목요일", timezone:"한국 시간 · KST", evening:"함께하는 저녁", program:"본행사", afterparty:"뒷풀이", scheduleNote:"두 일정 모두 ByUs Day 프로그램이며 같은 장소에서 이어집니다.",
    programTitle:"본행사 프로그램", programSteps:["오프닝", "식사(코스요리)", "세션 및 Q&A", "럭키드로우", "BYUS LIVE"], afterpartyProgram:"네트워킹·래플",
    securityTitle:"SECURITY NOTICE", entryRequired:"미군기지 출입 신청을 위해 주민등록번호 제출이 필요합니다.", entryPurpose:"제출 정보는 출입 승인 및 신원 확인 목적으로 사용됩니다.",
    accessPolicy:"출입 절차 참고: USFKI 5200.08A CH1", accessLink:"출입절차 규정 · 새 탭에서 보기",
    registrationPrivacyTitle:"주민등록번호 처리 안내", registrationPrivacyItems:"항목: 주민등록번호 13자리", registrationPrivacyPurpose:"목적: 미군기지 출입 승인 및 신원 확인",
    privacyRecipient:"출입명단 제공처: 용산미군기지 출입 담당부서", registrationRefusal:"정보를 제출하지 않으면 기지 출입 신청을 진행할 수 없습니다.",
    venue:"장소", location:"서울 용산 · 미군기지 내", venueNote:"기지 출입 안내는 신청 후 별도로 전해 드립니다.",
    vehicleEntry:"미군기지는 등록된 차량만 출입할 수 있습니다.", vehicleRequest:"차량 없이 방문해 주시길 부탁드립니다.", vehicleApology:"불편을 드려 죄송합니다.",
    enlargeMap:"약도 크게 보기", mapTitle:"Gate 1에서 호텔까지", mapDescription:"삼각지역 13번 출구와 녹사평역 4번 출구 사이, 고가도로 옆 보행로로 Gate 1에 접근합니다. 출입 확인 후 안내된 보행로를 따라 드래곤힐 로지로 이동합니다.", mapCaption:"위치 참고용 약도 · 실제 거리와 비례하지 않습니다.", walkingTitle:"도보 입장 순서", walkingSteps:["고가도로 바로 옆 인도를 이용해 Gate 1 초소로 이동합니다.", "출입 확인 후 인도를 따라 왼쪽으로 이동합니다.", "주차장을 대각선으로 지나 호텔에 도착합니다."], alternateStation:"녹사평역 4번 출구(6호선)에서도 Gate 1 방향으로 이동할 수 있습니다.",
    arrivalTitle:"오시는 길", arrivalIntro:"대중교통이나 택시를 이용해 주세요. 아래는 호텔 공식 안내에 따른 Gate 1 주변 경로입니다.",
    routeStation:"삼각지역 13번 출구 · 4·6호선", routeWalk:"도보 약 5분", routeGate:"용산미군기지 Gate 1 주변", gateAddress:"서울 용산구 용산동4가 1-10",
    taxiNote:"택시를 이용하시면 위 주소의 Gate 1 주변에서 내려 주세요.", mapIntro:"출입구 주변 참고 위치를 지도에서 확인하세요.", naverMap:"네이버 지도", googleMap:"Google Maps", newTab:"새 탭에서 보기",
    arrivalNote:"위 경로는 호텔의 일반 방문 안내입니다. 행사 출입구·집합 위치와 입장 절차는 신청자에게 별도로 안내합니다.", officialDirections:"호텔 공식 길 안내",
    formTitle:"참가 신청", formDescription:"아래 정보를 남겨 주세요. 행사와 출입 안내를 전해 드릴게요.",
    required:"모든 항목 필수", koreanName:"한글 이름", englishName:"영어 이름", phone:"휴대폰 번호", phoneHelp:"해외 번호는 국가번호부터 입력해 주세요.",
    residentRegistrationNumber:"주민등록번호", registrationNumberHelp:"출입 승인 및 신원 확인을 위한 필수정보입니다.",
    affiliation:"소속", occupation:"직업", email:"이메일", nationality:"국적", chooseCountry:"국적을 선택해 주세요",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"회사 또는 단체명", occupationPlaceholder:"직업 또는 맡고 있는 일",
    consent:"개인정보 수집·이용에 동의합니다.", privacyTitle:"일반 개인정보 수집·이용 안내", privacyController:"처리자: 샐리랩(ByUs)",
    privacyPurpose:"목적: 참가 신청 접수, 행사 안내, 기지 출입 명단 제출",
    privacyItems:"항목: 한글·영어 이름, 휴대폰 번호, 소속, 직업, 이메일, 국적",
    privacyRetention:"보유·파기: 행사 익일인 2026년 10월 23일에 모든 신청 정보를 파기합니다.",
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
    date:"Thursday, October 22, 2026", timezone:"Seoul time · KST", evening:"The evening", program:"Main event", afterparty:"After-party", scheduleNote:"Both are part of ByUs Day and continue at the same venue.",
    programTitle:"Main event program", programSteps:["Opening", "Multi-course dinner", "Sessions & Q&A", "Lucky draw", "BYUS LIVE"], afterpartyProgram:"Networking & raffle",
    securityTitle:"SECURITY NOTICE", entryRequired:"A Korean resident registration number is required to apply for access to the U.S. military base.", entryPurpose:"The information is used for access approval and identity verification.",
    accessPolicy:"Access procedure reference: USFKI 5200.08A CH1", accessLink:"Installation Access Policy · Opens in a new tab",
    registrationPrivacyTitle:"Resident registration number processing", registrationPrivacyItems:"Information: 13-digit Korean resident registration number", registrationPrivacyPurpose:"Purpose: military base access approval and identity verification",
    privacyRecipient:"Base entry list recipient: Yongsan Garrison access control office", registrationRefusal:"We cannot submit your base access application without this information.",
    venue:"Venue", location:"Yongsan, Seoul · on the U.S. military base", venueNote:"We’ll share base entry instructions separately after you register.",
    vehicleEntry:"Only registered vehicles may enter the U.S. military base.", vehicleRequest:"Please do not bring a personal vehicle.", vehicleApology:"We apologize for the inconvenience.",
    enlargeMap:"Enlarge the map", mapTitle:"From Gate 1 to the hotel", mapDescription:"Approach Gate 1 via the pedestrian path beside the overpass, between Samgakji Exit 13 and Noksapyeong Exit 4. After the entry check, follow the pedestrian path to Dragon Hill Lodge.", mapCaption:"Location guide · Not to scale.", walkingTitle:"Entering on foot", walkingSteps:["Use the pedestrian path right beside the overpass to reach Gate 1.", "After the entry check, follow the pedestrian path towards the left.", "Cross the parking lot diagonally to reach the hotel."], alternateStation:"You can also approach Gate 1 from Noksapyeong Station, Exit 4 (Line 6).",
    arrivalTitle:"Getting here", arrivalIntro:"Please use public transport or a taxi. This route to the Gate 1 area follows the hotel’s official directions.",
    routeStation:"Samgakji Station, Exit 13 · Lines 4 & 6", routeWalk:"About a 5-minute walk", routeGate:"Yongsan Garrison Gate 1 area", gateAddress:"1-10 Yongsan-dong 4-ga, Yongsan-gu, Seoul",
    taxiNote:"If taking a taxi, get off near Gate 1 at the address above.", mapIntro:"View the area around the entrance on a map.", naverMap:"Naver Map", googleMap:"Google Maps", newTab:"Opens in a new tab",
    arrivalNote:"These are the hotel’s general visitor directions. We’ll send registered guests the event entrance, meeting point, and entry instructions separately.", officialDirections:"Official hotel directions",
    formTitle:"RSVP", formDescription:"Leave your details below. We’ll be in touch with event and entry information.",
    required:"All fields required", koreanName:"Korean name", englishName:"English name", phone:"Mobile number", phoneHelp:"Include your country code for numbers outside Korea.",
    residentRegistrationNumber:"Resident registration number", registrationNumberHelp:"Required for base access approval and identity verification.",
    affiliation:"Company / organization", occupation:"Occupation / role", email:"Email", nationality:"Nationality", chooseCountry:"Select your nationality",
    koreanNamePlaceholder:"홍길동", englishNamePlaceholder:"Gildong Hong", affiliationPlaceholder:"Company or organization", occupationPlaceholder:"Your occupation or role",
    consent:"I agree to the collection and use of my personal information.", privacyTitle:"Personal information collection and use", privacyController:"Controller: Sallylab (ByUs)",
    privacyPurpose:"Purpose: RSVP processing, event communication, and submission of the base entry list",
    privacyItems:"Information: Korean and English names, mobile number, company, occupation, email, and nationality",
    privacyRetention:"Retention and deletion: all RSVP information will be deleted on October 23, 2026, the day after the event.",
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
        <figure className={styles.artwork}>
          <a className={styles.posterLink} href={POSTER_SRC} target="_blank" rel="noopener noreferrer">
            <Image src={POSTER_SRC} alt={t.posterAlt} width={1024} height={1536} sizes="(min-width: 1024px) 580px, 100vw" loading="eager" />
            <span className={styles.posterCaption}>{t.posterLink}</span>
          </a>
        </figure>
        <div className={styles.dateRow}><div><p className={styles.eyebrow}>{t.timezone}</p><time dateTime="2026-10-22" className={styles.date}>2026.10.22</time><p className={styles.day}>{t.date}</p></div><span className={styles.seal} aria-hidden="true">BYUS<br /><b>22</b><br />OCTOBER</span></div>
        <section className={styles.schedule} aria-labelledby="schedule-title">
          <h2 id="schedule-title">{t.evening}</h2>
          <dl><div><dt>{t.program}</dt><dd>18:30 <span>—</span> 21:30</dd></div><div><dt>{t.afterparty}</dt><dd>21:30 <span>—</span> 24:00</dd></div></dl>
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
        <section className={styles.arrival} aria-labelledby="arrival-title">
          <h2 id="arrival-title">{t.arrivalTitle}</h2>
          <p>{t.arrivalIntro}</p>
          <figure className={styles.arrivalMap}>
            <a className={styles.mapEnlargeLink} href={`/images/connect/byus-day/gate-1-directions-${locale === "ko" ? "ko" : "en"}-20261004-v2.svg`} target="_blank" rel="noopener noreferrer" aria-label={`${t.enlargeMap} · ${t.newTab}`}>
              <Image src={`/images/connect/byus-day/gate-1-directions-${locale === "ko" ? "ko" : "en"}-20261004-v2.svg`} alt={t.mapTitle} aria-describedby="arrival-map-description" width={905} height={520} sizes="(min-width: 1024px) 580px, 100vw" unoptimized />
              <span className={styles.mapEnlargeLabel}>{t.enlargeMap}<ArrowRight size={16} aria-hidden="true" /></span>
            </a>
            <span id="arrival-map-description" className={styles.srOnly}>{t.mapDescription}</span>
            <figcaption>{t.mapCaption}</figcaption>
          </figure>
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
        </section>
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
              <a href={ACCESS_CONTROL_URL} target="_blank" rel="noopener noreferrer">{t.accessLink}<ArrowRight size={16} aria-hidden="true" /></a>
            </section>
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
              <details><summary>{t.privacyTitle}</summary><div className={styles.privacyCopy}><p>{t.privacyController}</p><p>{t.privacyPurpose}</p><p>{t.privacyItems}</p><p>{t.privacyRecipient}</p><p>{t.privacyRetention}</p><p>{t.privacyRefusal}</p></div></details>
              <details><summary>{t.registrationPrivacyTitle}</summary><div className={styles.privacyCopy}><p>{t.privacyController}</p><p>{t.registrationPrivacyItems}</p><p>{t.registrationPrivacyPurpose}</p><p>{t.privacyRecipient}</p><p>{t.privacyRetention}</p><p>{t.registrationRefusal}</p><p>{t.accessPolicy}</p></div></details>
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
