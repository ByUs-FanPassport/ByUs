import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCountries } from "libphonenumber-js";
import { ByusDayScreen } from "@/features/connect/byus-day-screen";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await headers()).get("x-byus-locale") === "ko" ? "ko" : "en";
  const title = locale === "ko" ? "kyaa wave | 스태프 참가 신청" : "kyaa wave | Staff RSVP";
  const description = locale === "ko"
    ? "10월 22일 목요일, 서울 용산 Dragon Hill Lodge. 본행사 18:30–21:30, 뒷풀이 21:30–24:00. 행사 스태프 전용 참가 신청입니다."
    : "Staff registration for kyaa wave on Thursday, October 22 at Dragon Hill Lodge, Yongsan, Seoul. Main event 18:30–21:30, after-party 21:30–24:00 KST.";
  return {
    title, description,
    robots: { index: false, follow: false },
    alternates: { canonical: "/connect/kyaa-wave/staff" },
    openGraph: { title, description, url: "/connect/kyaa-wave/staff", images: [{ url: "/images/connect/kyaa-wave/share-20261008.jpg", width: 1200, height: 630, alt: "kyaa wave · 2026.10.22" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/images/connect/kyaa-wave/share-20261008.jpg"] },
  };
}

export default async function ByusDayPage() {
  const locale = (await headers()).get("x-byus-locale") === "ko" ? "ko" : "en";
  // Keep the server's country names: browser ICU versions can use different labels.
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const countries = getCountries().map(code => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));
  return <ByusDayScreen staffCountries={countries} />;
}
