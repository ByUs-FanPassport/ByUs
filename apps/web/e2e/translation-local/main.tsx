import { createRoot } from "react-dom/client";
import { PostCard } from "@/features/fan-posts/ui/post-card";
import type { FanPost } from "@/features/fan-posts/domain/content";
import { parseAppLocale } from "@/i18n/locales";
import "@/app/globals.css";
import "pretendard/dist/web/static/pretendard.css";

const locale = parseAppLocale(new URLSearchParams(location.search).get("locale"));
document.documentElement.lang = locale;
const bodies = ["엘리나 유튜브 재개!!", "We are so excited to see everyone at the concert tonight!", "🎉❤️ 123!!"];
const base: FanPost = { id: "10000000-0000-4000-8000-000000000001", celebritySlug: "elina", body: "", visibility: "public", revision: 1,
  author: { nickname: "ElinaFan", avatarUrl: "/images/avatars/star-cream.webp" }, assets: [], createdAt: "2026-10-03T04:21:00Z", updatedAt: "2026-10-03T04:21:00Z",
  isOwner: false, likeCount: 12, liked: false, commentCount: 3 };
createRoot(document.getElementById("root")!).render(<main style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px", fontFamily: "Pretendard, sans-serif" }}>
  <h1 style={{ fontSize: 24 }}>{locale === "ko" ? "팬게시판" : "Fan posts"}</h1>
  {bodies.map((body, index) => <PostCard key={index} post={{ ...base, body, id: `10000000-0000-4000-8000-00000000000${index + 1}`,
    assets: index < 2 ? [{ id: `20000000-0000-4000-8000-00000000000${index + 1}`, width: 800, height: 600 }] : [] }} locale={locale} onChanged={() => {}} />)}
</main>);
