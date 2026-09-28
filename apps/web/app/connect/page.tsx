import type { Metadata } from "next";
import { headers } from "next/headers";
import { ConnectScreen } from "@/features/connect/connect-screen";

export async function generateMetadata(): Promise<Metadata> {
  const ko = (await headers()).get("x-byus-locale") === "ko";
  const title = ko ? "ByUs | 함께한 순간을 모으는 팬 패스포트" : "ByUs | A passport for your favorite moments";
  const description = ko
    ? "좋아하는 아티스트와의 순간을 기록하고, 새로운 팬 이벤트에도 참여해 보세요. ByUs 공식 채널과 팀을 만나보세요."
    : "Collect moments with your favorite artists and discover your next fan experience. Explore ByUs and meet our team.";
  return {
    title, description,
    alternates: { canonical: "/connect" },
    openGraph: { title, description, url: "/connect", images: [{ url: "/images/connect/share.jpg", width: 1200, height: 630, alt: "ByUs Fan Passport" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/images/connect/share.jpg"] },
  };
}

export default function ConnectPage() {
  return <ConnectScreen />;
}
