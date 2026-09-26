import type { FanPost, PostComment } from "../../features/fan-posts/domain/content";
import type { ChzzkPost } from "../../features/fanpage/domain/chzzk-posts";
import type { LiveSurveyResponse } from "../../features/live/domain/live-survey";
import type { OfficialMedia } from "../../features/media/domain/official-media";
import type { QuizAttemptProjection } from "../../features/quiz/domain/quiz-attempt";

export const discoveryIds = {
  post: "10000000-0000-4000-8000-000000000001",
  comment: "20000000-0000-4000-8000-000000000002",
  attempt: "11111111-1111-4111-8111-111111111111",
  passport: "22222222-2222-4222-8222-222222222222",
} as const;

export const discoveryPost: FanPost = {
  id: discoveryIds.post,
  celebritySlug: "elina",
  body: "엘리나와 함께한 오늘의 순간을 팬들과 나눠요. 다음 LIVE에서도 만나요!",
  visibility: "public",
  revision: 1,
  author: { nickname: "Jewel_KAT", avatarUrl: "/images/avatars/star-pink.webp" },
  assets: [],
  createdAt: "2026-09-26T11:20:00+09:00",
  updatedAt: "2026-09-26T11:20:00+09:00",
  isOwner: false,
  likeCount: 24,
  liked: false,
  commentCount: 1,
};

export const discoveryComments: PostComment[] = [{
  id: discoveryIds.comment,
  postId: discoveryIds.post,
  parentId: null,
  body: "사진 없이도 그날의 분위기가 전해져요. 다음 LIVE도 같이 기다릴게요!",
  revision: 1,
  author: { nickname: "별빛팬", avatarUrl: "/images/avatars/heart-lavender.webp" },
  createdAt: "2026-09-26T11:42:00+09:00",
  isOwner: false,
}];

const quizQuestions: QuizAttemptProjection["questions"] = [
  ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "엘리나의 생일은 언제인가요?", "4월 22일", "5월 12일"],
  ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "팬들과 가장 먼저 나누고 싶은 것은?", "새로운 무대", "비밀로 간직하기"],
  ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "ByUs에서 함께 모으는 기록은?", "Fan Passport", "쇼핑 포인트"],
].map(([id, prompt, first, second], index) => ({
  id,
  position: index + 1,
  prompt,
  selectedOptionId: index === 0 ? `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb1${index + 1}1` : null,
  options: [
    { id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb1${index + 1}1`, position: 1, label: first },
    { id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb1${index + 1}2`, position: 2, label: second },
  ],
}));

export const discoveryQuizOpen: QuizAttemptProjection = {
  attempt: { id: discoveryIds.attempt, status: "open", score: null, submittedAt: null },
  questions: quizQuestions,
};

export const discoveryQuizPassed: QuizAttemptProjection = {
  attempt: { id: discoveryIds.attempt, status: "passed", score: 2, submittedAt: "2026-09-26T12:00:00+09:00" },
  questions: quizQuestions.map((question) => ({ ...question, selectedOptionId: question.options[0]!.id })),
};

export const discoverySurvey: LiveSurveyResponse = {
  survey: {
    id: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
    version: 1,
    questions: [
      { id: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a", type: "single_choice", question: "오늘 LIVE에서 가장 좋았던 순간은?", required: true, order: 1, options: [
        { id: "90339735-90b4-4e85-8707-d2037a6d35f9", label: "오프닝", order: 1 },
        { id: "62aac40d-dc92-4029-a579-a3bb97fa9132", label: "팬들과의 대화", order: 2 },
      ] },
      { id: "af425d21-e8aa-4a7e-b20f-57b019b94b37", type: "multiple_choice", question: "다음에 보고 싶은 콘텐츠를 골라 주세요.", required: false, order: 2, options: [
        { id: "81339735-90b4-4e85-8707-d2037a6d35f9", label: "라이브 토크", order: 1 },
        { id: "72aac40d-dc92-4029-a579-a3bb97fa9132", label: "무대 비하인드", order: 2 },
      ] },
      { id: "4df8415a-b9ec-4cb8-8e50-73850b887dc1", type: "rating_1_5", question: "오늘 LIVE는 어땠나요?", required: true, order: 3, options: [] },
      { id: "f4742cc2-85c2-4e16-9df1-4a05b1d21346", type: "free_text", question: "엘리나에게 전하고 싶은 말을 남겨 주세요.", required: false, order: 4, options: [] },
    ],
  },
  eligibility: { completedAttendance: true },
  response: null,
  completion: null,
};

export const discoveryMedia: OfficialMedia[] = [{
  id: "discovery-photo",
  kind: "photos",
  title: "엘리나와 함께한 9월의 순간",
  image: "/images/guest-home/elina-card.jpg",
  asset: null,
  href: "/c/elina/notices/welcome",
  date: "2026-09-26T09:00:00+09:00",
}, {
  id: "discovery-video",
  kind: "videos",
  title: "팬들에게 보내는 짧은 인사",
  image: null,
  asset: null,
  href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  date: "2026-09-25T18:00:00+09:00",
}];

export const discoveryChzzkPost: ChzzkPost = {
  id: "987654321",
  text: "오늘도 함께해 주셔서 고마워요! 다음 방송에서 다시 만나요 💜",
  date: "2026-09-26",
  images: [],
};

export function discoveryFixtureResponse(url: string, method: string, pathname: string): Response | null {
  if (pathname === `/c/elina/community/${discoveryIds.post}` && method === "GET") {
    if (url.includes("/comments?")) return Response.json({ items: discoveryComments, nextCursor: null });
    if (url.startsWith(`/api/posts/${discoveryIds.post}?`)) return Response.json({ post: discoveryPost });
  }
  if (pathname === "/c/elina/verify/questions" && method === "POST" && url.startsWith("/api/celebrities/elina/quiz/attempts?")) {
    return Response.json({ result: { kind: "attempt", ...discoveryQuizOpen } });
  }
  if (pathname === "/c/elina/verify/result" && method === "GET" && url.startsWith(`/api/quiz-attempts/${discoveryIds.attempt}?`)) {
    return Response.json({ attempt: discoveryQuizPassed });
  }
  if (pathname === "/live/discovery-survey/survey" && method === "GET" && url.startsWith("/api/live-events/discovery-survey/survey?")) {
    return Response.json(discoverySurvey);
  }
  if ((pathname === "/elina" || pathname === "/c/elina") && new URLSearchParams(location.search).get("fixture")?.startsWith("media-")) {
    const ready = new URLSearchParams(location.search).get("fixture") === "media-ready";
    if (method === "GET" && url.startsWith("/api/celebrities/elina/media?")) return Response.json({ items: ready ? discoveryMedia : [], nextCursor: null });
    if (method === "GET" && url === "/api/celebrities/elina/instagram") return Response.json({ items: [] });
    if (method === "GET" && url.startsWith("/api/live-events?")) return Response.json({ catalog: { replay: [] } });
  }
  return null;
}
