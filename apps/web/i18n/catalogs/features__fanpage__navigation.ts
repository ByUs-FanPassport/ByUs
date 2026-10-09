import type { AppLocale } from "../locales";

type NavigationCopy = {
  main: Record<"home" | "board" | "certifications" | "events" | "leaderboard", string>;
  board: Record<"feed" | "media" | "live", string>;
  boardMenu: string;
};

const copy = {
  ko: { main: { home: "홈", board: "게시판", certifications: "찐팬 인증", events: "이벤트", leaderboard: "팬 리더보드" }, board: { feed: "피드", media: "공식 미디어", live: "LIVE" }, boardMenu: "게시판 메뉴" },
  en: { main: { home: "Home", board: "Board", certifications: "Fan verification", events: "Events", leaderboard: "Fan leaderboard" }, board: { feed: "Feed", media: "Official media", live: "LIVE" }, boardMenu: "Board menu" },
  ja: { main: { home: "ホーム", board: "掲示板", certifications: "ファン認証", events: "イベント", leaderboard: "ファンランキング" }, board: { feed: "フィード", media: "公式メディア", live: "LIVE" }, boardMenu: "掲示板メニュー" },
  "zh-Hans": { main: { home: "首页", board: "社区", certifications: "粉丝验证", events: "活动", leaderboard: "粉丝排行榜" }, board: { feed: "动态", media: "官方媒体", live: "LIVE" }, boardMenu: "社区菜单" },
  "zh-Hant": { main: { home: "首頁", board: "社群", certifications: "粉絲驗證", events: "活動", leaderboard: "粉絲排行榜" }, board: { feed: "動態", media: "官方媒體", live: "LIVE" }, boardMenu: "社群選單" },
  es: { main: { home: "Inicio", board: "Comunidad", certifications: "Verificación de fans", events: "Eventos", leaderboard: "Clasificación de fans" }, board: { feed: "Publicaciones", media: "Contenido oficial", live: "LIVE" }, boardMenu: "Menú de la comunidad" },
  id: { main: { home: "Beranda", board: "Komunitas", certifications: "Verifikasi penggemar", events: "Acara", leaderboard: "Papan peringkat fan" }, board: { feed: "Feed", media: "Media resmi", live: "LIVE" }, boardMenu: "Menu komunitas" },
  vi: { main: { home: "Trang chủ", board: "Cộng đồng", certifications: "Xác minh fan", events: "Sự kiện", leaderboard: "Bảng xếp hạng fan" }, board: { feed: "Bảng tin", media: "Nội dung chính thức", live: "LIVE" }, boardMenu: "Menu cộng đồng" },
  th: { main: { home: "หน้าแรก", board: "ชุมชน", certifications: "ยืนยันแฟนคลับ", events: "กิจกรรม", leaderboard: "อันดับแฟนคลับ" }, board: { feed: "ฟีด", media: "สื่อทางการ", live: "LIVE" }, boardMenu: "เมนูชุมชน" },
  pt: { main: { home: "Início", board: "Comunidade", certifications: "Verificação de fã", events: "Eventos", leaderboard: "Ranking de fãs" }, board: { feed: "Publicações", media: "Mídia oficial", live: "LIVE" }, boardMenu: "Menu da comunidade" },
  fr: { main: { home: "Accueil", board: "Communauté", certifications: "Vérification de fan", events: "Événements", leaderboard: "Classement des fans" }, board: { feed: "Fil", media: "Médias officiels", live: "LIVE" }, boardMenu: "Menu de la communauté" },
} satisfies Record<AppLocale, NavigationCopy>;

export function fanPageNavigationCopy(locale: AppLocale): NavigationCopy {
  return copy[locale];
}
