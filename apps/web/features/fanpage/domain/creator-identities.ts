type CreatorIdentity = {
  ko: string;
  en: string;
  logo?: string;
  fandom?: { name: string; ko: string; source: string; mark?: string };
};

// Official-source review and unchanged CMS spellings: docs/content/creator-identities.md.
export const creatorIdentities: Readonly<Record<string, CreatorIdentity>> = {
  elina: { ko: "엘리나", en: "Elina Karimova" },
  changha: { ko: "창하", en: "CHANGHA" },
  yuna: { ko: "유나", en: "Yuna Karimova" },
  "jenny-jeong": { ko: "정제니", en: "Jenny Jeong" },
  aryeom: { ko: "아렴", en: "ARYEOM" },
  "park-myungho": { ko: "박명호", en: "Myungho Park" },
  ifewknow: { ko: "이퓨", en: "ifew" },
  "thisisj-official": { ko: "재희", en: "Jaehee" },
  hyunji: { ko: "현지", en: "Hyunji" },
  nchive: {
    ko: "엔카이브", en: "NCHIVE", logo: "/images/celebrities/nchive/official-emblem-20261014.jpg",
    fandom: { name: "SAVE", ko: "세이브", source: "https://x.com/nchiveofficial/status/1750805783091229003", mark: "/images/celebrities/nchive/save-announcement.jpg" },
  },
  wena: {
    ko: "위나", en: "We;Na", logo: "/images/celebrities/wena/official-logo.jpg",
    fandom: { name: "mymean", ko: "마이민", source: "https://www.instagram.com/p/Cgi79qPJVt-/" },
  },
};

export function creatorIdentity(slug: string): CreatorIdentity | undefined {
  return Object.hasOwn(creatorIdentities, slug) ? creatorIdentities[slug] : undefined;
}
