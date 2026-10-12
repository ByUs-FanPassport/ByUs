"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, MapPin } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./byus-day-screen.module.css";

const DIRECTIONS_URL = "https://www.dragonhilllodge.com/your-stay/getting-here";
const GATE_ADDRESS = "서울 용산구 용산동4가 1-10";
const NAVER_MAP_URL = `https://map.naver.com/p/search/${encodeURIComponent(GATE_ADDRESS)}`;
const GOOGLE_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(GATE_ADDRESS)}`;

const copy = {
  ko: {
    deadlineLabel:"참가 신청 마감", deadline:"신규 신청을 받지 않습니다.",
    back:"kyaa", language:"언어 선택", skip:"마감 안내로 이동", invitation:"초대합니다",
    headline:"엔터테인먼트와 기술이 만나는\nEnter × Tech의 밤.",
    introduction:"kyaa wave는 엔터테인먼트와 기술의 경계를 넘어 새로운 가능성과 협업을 연결하는 자리입니다.\n쇼케이스와 대담, 네트워킹을 통해 새로운 아이디어와 사람을 만나보세요.",
    posterAlt:"kyaa wave Enter × Tech 한글 행사 포스터", posterLink:"한글 포스터 · 새 탭에서 크게 보기",
    date:"2026년 10월 22일 목요일 18:30 시작", timezone:"한국 시간 · KST", evening:"함께하는 저녁", program:"본행사", afterparty:"뒷풀이", scheduleNote:"뒷풀이는 본행사에 이어 같은 호텔 1층 펍에서 진행합니다.",
    programTitle:"본행사 프로그램", programSteps:["오프닝", "식사(코스요리)", "세션 및 Q&A", "럭키드로우", "kyaa LIVE"], afterpartyProgram:"네트워킹·래플",
    venue:"장소", location:"서울 용산 · 미군기지 내", venueNote:"신청하신 분들께는 기지 출입 안내를 별도로 전해 드립니다.",
    parkingTitle:"행사장 내 주차 불가", parkingDescription:"대중교통이나 택시를 이용해 주세요. 차량 없이 방문해 주시기 바랍니다.",
    enlargeMap:"약도 크게 보기", mapTitle:"Gate 1에서 호텔까지", mapDescription:"삼각지역 13번 출구와 녹사평역 4번 출구 사이, 고가도로 옆 보행로로 Gate 1에 접근합니다. 출입 확인 후 안내된 보행로를 따라 드래곤힐 로지로 이동합니다.", mapCaption:"위치 참고용 약도 · 실제 거리와 비례하지 않습니다.", walkingTitle:"도보 입장 순서", walkingSteps:["고가도로 바로 옆 인도를 이용해 Gate 1 초소로 이동합니다.", "출입 확인 후 인도를 따라 왼쪽으로 이동합니다.", "주차장을 대각선으로 지나 호텔에 도착합니다."], alternateStation:"녹사평역 4번 출구(6호선)에서도 Gate 1 방향으로 이동할 수 있습니다.",
    arrivalTitle:"오시는 길", arrivalIntro:"대중교통이나 택시를 이용해 주세요. 아래는 호텔 공식 안내에 따른 Gate 1 주변 경로입니다.",
    routeStation:"삼각지역 13번 출구 · 4·6호선", routeWalk:"도보 약 5분", routeGate:"용산미군기지 Gate 1 주변", gateAddress:"서울 용산구 용산동4가 1-10",
    taxiNote:"택시를 이용하시면 위 주소의 Gate 1 주변에서 내려 주세요.", mapIntro:"출입구 주변 참고 위치를 지도에서 확인하세요.", naverMap:"네이버 지도", googleMap:"Google Maps", newTab:"새 탭에서 보기",
    arrivalNote:"위 경로는 호텔의 일반 방문 안내입니다. 행사 출입구·집합 위치와 입장 절차는 신청자에게 별도로 안내합니다.", officialDirections:"호텔 공식 길 안내",
    formTitle:"참가 신청이 마감되었습니다.", formDescription:"kyaa wave에 관심을 가져 주셔서 감사합니다.",
    successNote:"신청 접수는 참가 및 기지 출입 확정을 의미하지 않습니다.", return:"kyaa 둘러보기", footer:"라이브 팬덤 플랫폼",
  },
  en: {
    deadlineLabel:"RSVPs closed", deadline:"We are no longer accepting registrations.",
    back:"kyaa", language:"Choose language", skip:"Skip to registration status", invitation:"You’re invited",
    headline:"Where entertainment meets technology.\nEnter × Tech at kyaa wave.",
    introduction:"kyaa wave brings people together across entertainment and technology to explore new possibilities and collaborations.\nMeet new people and ideas through showcases, fireside chats, and networking.",
    posterAlt:"kyaa wave Enter × Tech English event poster", posterLink:"English poster · Open full size in a new tab",
    date:"Thursday, October 22, 2026 · Starts at 18:30", timezone:"Seoul time · KST", evening:"The evening", program:"Main event", afterparty:"After-party", scheduleNote:"The after-party follows the main event at the pub on the hotel’s first floor.",
    programTitle:"Main event program", programSteps:["Opening", "Multi-course dinner", "Sessions & Q&A", "Lucky draw", "kyaa LIVE"], afterpartyProgram:"Networking & raffle",
    venue:"Venue", location:"Yongsan, Seoul · on the U.S. military base", venueNote:"We’ll share base entry instructions separately after you register.",
    parkingTitle:"No parking at the venue", parkingDescription:"Please use public transport or a taxi. Do not bring a personal vehicle.",
    enlargeMap:"Enlarge the map", mapTitle:"From Gate 1 to the hotel", mapDescription:"Approach Gate 1 via the pedestrian path beside the overpass, between Samgakji Exit 13 and Noksapyeong Exit 4. After the entry check, follow the pedestrian path to Dragon Hill Lodge.", mapCaption:"Location guide · Not to scale.", walkingTitle:"Entering on foot", walkingSteps:["Use the pedestrian path right beside the overpass to reach Gate 1.", "After the entry check, follow the pedestrian path towards the left.", "Cross the parking lot diagonally to reach the hotel."], alternateStation:"You can also approach Gate 1 from Noksapyeong Station, Exit 4 (Line 6).",
    arrivalTitle:"Getting here", arrivalIntro:"Please use public transport or a taxi. This route to the Gate 1 area follows the hotel’s official directions.",
    routeStation:"Samgakji Station, Exit 13 · Lines 4 & 6", routeWalk:"About a 5-minute walk", routeGate:"Yongsan Garrison Gate 1 area", gateAddress:"1-10 Yongsan-dong 4-ga, Yongsan-gu, Seoul",
    taxiNote:"If taking a taxi, get off near Gate 1 at the address above.", mapIntro:"View the area around the entrance on a map.", naverMap:"Naver Map", googleMap:"Google Maps", newTab:"Opens in a new tab",
    arrivalNote:"These are the hotel’s general visitor directions. We’ll send registered guests the event entrance, meeting point, and entry instructions separately.", officialDirections:"Official hotel directions",
    formTitle:"RSVPs are now closed.", formDescription:"Thank you for your interest in kyaa wave.",
    successNote:"An RSVP does not confirm attendance or access to the base.", return:"Explore kyaa", footer:"Live fandom platform",
  },
} as const;

export function ByusDayScreen() {
  const { locale: appLocale } = useAppLocale();
  const locale = appLocale === "ko" ? "ko" : "en";
  const t = copy[locale];
  const posterSrc = `/images/connect/kyaa-wave/poster-${locale}-20261008.webp`;
  const arrivalRef = useRef<HTMLDetailsElement>(null);

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

  return <div className={styles.page} lang={locale}>
    <a className={styles.skipLink} href="#rsvp">{t.skip}</a>
    <header className={styles.header}>
      <Link href={`/connect?locale=${locale}#links`} className={styles.back}><ArrowLeft size={18} aria-hidden="true" /><Image src="/images/connect/kyaa-wave/logo.svg" alt={t.back} width={100} height={48} className={styles.brandLogo} unoptimized /></Link>
      <span className={styles.headerCaption}>A kyaa GATHERING</span>
      <a href="#rsvp" className={styles.headerRsvp}>{t.deadlineLabel} <ArrowRight size={16} aria-hidden="true" /></a>
      <nav className={styles.languages} aria-label={t.language}>
        <Link href="/connect/kyaa-wave?locale=ko" replace aria-current={locale === "ko" ? "true" : undefined} aria-label="한국어" lang="ko">KO</Link>
        <Link href="/connect/kyaa-wave?locale=en" replace aria-current={locale === "en" ? "true" : undefined} aria-label="English" lang="en">EN</Link>
      </nav>
    </header>
    <aside className={styles.deadline} aria-label={t.deadlineLabel}><span>{t.deadlineLabel}</span><strong>{t.deadline}</strong></aside>
    <main className={styles.canvas}>
      <section className={styles.invitation} aria-labelledby="event-title">
        <div className={styles.invitationTop}><p className={styles.eyebrow}>{t.invitation}</p></div>
        <h1 id="event-title" className={styles.title}>kyaa wave</h1>
        <p className={styles.headline}>{t.headline}</p>
        <p className={styles.introduction}>{t.introduction}</p>
        <div className={styles.dateRow}><div><p className={styles.eyebrow}>{t.timezone}</p><time dateTime="2026-10-22" className={styles.date}>2026.10.22</time></div><span className={styles.seal} aria-hidden="true">kyaa<br /><b>22</b><br />OCTOBER</span></div>
        <div className={styles.eventSummary}><p className={styles.day}>{t.date}</p><p>{locale === "ko" ? "장소: 용산미군기지 • 드래곤힐로지(DHL)" : "Venue: Yongsan Garrison • Dragon Hill Lodge (DHL)"}</p><p className={styles.parkingSummary}>{t.parkingTitle}</p></div>
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
        <div className={styles.formHeading}><p className={styles.eyebrow}>RSVP · kyaa wave</p><h2 id="rsvp-title">{t.formTitle}</h2><p>{t.formDescription}</p></div>
        <aside className={styles.parkingNotice} aria-label={t.parkingTitle}><h3>{t.parkingTitle}</h3><p>{t.parkingDescription}</p></aside>
        <p className={styles.closedNote}>{locale === "ko" ? "신청하신 분들께는 행사와 출입 안내를 별도로 전해 드립니다." : "Registered guests will receive event details and base entry instructions separately."}</p>
        <p className={styles.hint}>{t.successNote}</p>
        <FanAction href={"/?locale=" + locale} variant="neutral" fullWidth className={styles.return}>{t.return}</FanAction>
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
          <div className={styles.accessNotes}><p><strong>{t.parkingTitle}</strong></p><p>{t.parkingDescription}</p></div>
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
    <footer className={styles.footer}><Image src="/images/connect/kyaa-wave/logo.svg" alt="kyaa" width={100} height={48} className={styles.brandLogo} unoptimized /><span>{t.footer}</span><span>SEOUL, 2026</span></footer>

  </div>;
}
