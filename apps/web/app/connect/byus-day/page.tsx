import type { Metadata } from "next";
import { headers } from "next/headers";
import { ByusDayScreen } from "@/features/connect/byus-day-screen";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await headers()).get("x-byus-locale") === "ko" ? "ko" : "en";
  const title = locale === "ko" ? "BYUS DAY | 참가 신청" : "BYUS DAY | RSVP";
  const description = locale === "ko"
    ? "10월 15일 19:00–21:00, 호텔 엘리에나 1층 카페 ByusSpace. 공식행사 후에도 자유롭게 네트워킹을 이어가세요. 무료 · 주최자 승인제."
    : "October 15, 19:00–21:00 at ByusSpace, Hotel Eliena 1F Café. Stay for open networking after the official program. Free · host approval required.";
  const poster = `/images/connect/byus-day/poster-${locale}.webp`;
  return {
    title, description,
    alternates: { canonical: "/connect/byus-day" },
    openGraph: { title, description, url: "/connect/byus-day", images: [{ url: poster, width: 1024, height: 1536, alt: "BYUS DAY" }] },
    twitter: { card: "summary_large_image", title, description, images: [poster] },
  };
}

export default function ByusDayPage() {
  return <ByusDayScreen />;
}
