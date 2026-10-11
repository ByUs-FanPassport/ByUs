import type { AppLocale } from "../locales";

export const fanPageBrandCopy = {
  ko: { officialPost: "브랜드 소식", officialWebsite: "공식 웹사이트", website: "웹사이트", ticket: "예매·참가 신청", intro: (name: string) => `${name}의 공식 소식과 커뮤니티 이야기를 한곳에서 확인하세요.` },
  en: { officialPost: "Brand updates", officialWebsite: "Official website", website: "Website", ticket: "Tickets & registration", intro: (name: string) => `Official ${name} updates and community stories in one place.` },
  ja: { officialPost: "ブランド情報", officialWebsite: "公式サイト", website: "ウェブサイト", ticket: "チケット・参加申込", intro: (name: string) => `${name}の公式情報とコミュニティの投稿をまとめて確認できます。` },
  "zh-Hans": { officialPost: "品牌动态", officialWebsite: "官方网站", website: "网站", ticket: "购票·报名参加", intro: (name: string) => `在这里查看${name}的官方动态和社区故事。` },
  "zh-Hant": { officialPost: "品牌動態", officialWebsite: "官方網站", website: "網站", ticket: "購票·報名參加", intro: (name: string) => `在這裡查看${name}的官方動態和社群故事。` },
  es: { officialPost: "Novedades de la marca", officialWebsite: "Sitio oficial", website: "Sitio web", ticket: "Entradas e inscripción", intro: (name: string) => `Consulta las novedades oficiales de ${name} y las historias de la comunidad.` },
  id: { officialPost: "Kabar merek", officialWebsite: "Situs resmi", website: "Situs web", ticket: "Tiket & pendaftaran", intro: (name: string) => `Lihat kabar resmi ${name} dan cerita komunitas di sini.` },
  vi: { officialPost: "Tin thương hiệu", officialWebsite: "Trang web chính thức", website: "Trang web", ticket: "Đặt vé · Đăng ký tham gia", intro: (name: string) => `Xem tin chính thức từ ${name} và câu chuyện cộng đồng tại đây.` },
  th: { officialPost: "ข่าวสารแบรนด์", officialWebsite: "เว็บไซต์ทางการ", website: "เว็บไซต์", ticket: "จองบัตร · สมัครเข้าร่วม", intro: (name: string) => `ดูข่าวสารทางการของ ${name} และเรื่องราวจากชุมชนได้ที่นี่` },
  pt: { officialPost: "Novidades da marca", officialWebsite: "Site oficial", website: "Site", ticket: "Ingressos e inscrição", intro: (name: string) => `Veja as novidades oficiais de ${name} e as histórias da comunidade.` },
  fr: { officialPost: "Actualités de la marque", officialWebsite: "Site officiel", website: "Site web", ticket: "Billetterie et inscription", intro: (name: string) => `Retrouvez les actualités officielles de ${name} et les histoires de la communauté.` },
} satisfies Record<AppLocale, { officialPost: string; officialWebsite: string; website: string; ticket: string; intro: (name: string) => string }>;
