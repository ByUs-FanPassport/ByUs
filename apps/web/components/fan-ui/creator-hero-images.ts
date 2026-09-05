/** Dedicated banner sources; profile portraits remain independent. */
export type CreatorHeroImage = Readonly<{
  src: string;
  mobileSrc?: string;
  desktopFit?: "contain";
  background?: string;
  desktopPosition: string;
  mobilePosition: string;
}>;

export const creatorHeroImages: Readonly<Record<string, CreatorHeroImage>> = {
  changha: { src: "/images/celebrities/changha/hero-source.jpg", mobileSrc: "/images/celebrities/changha/hero-mobile.jpg", desktopPosition: "50% 0%", mobilePosition: "50% 10%" },
  elina: { src: "/images/celebrities/elina/hero-beach.jpg", mobileSrc: "/images/celebrities/elina/hero-source.jpg", desktopPosition: "50% 10%", mobilePosition: "50% 100%" },
  yuna: { src: "/images/celebrities/yuna/hero-beach.jpg", mobileSrc: "/images/celebrities/yuna/hero-studio-mobile.jpg", background: "#ececec", desktopPosition: "50% 0%", mobilePosition: "50% 0%" },
  "jenny-jeong": { src: "/images/celebrities/jenny-jeong/hero-source.jpg", desktopPosition: "50% 25%", mobilePosition: "53% 25%" },
  xin: { src: "/images/celebrities/xin/hero-concept.jpg", mobileSrc: "/images/celebrities/xin/hero-concept-mobile.jpg", desktopPosition: "50% 15%", mobilePosition: "50% 25%" },
  aryeom: { src: "/images/celebrities/aryeom/hero-portrait.jpg", desktopFit: "contain", background: "#887b69", desktopPosition: "right center", mobilePosition: "50% 20%" },
  ifewknow: { src: "/images/celebrities/ifewknow/hero-studio.jpg", desktopPosition: "50% 45%", mobilePosition: "50% 70%" },
  "park-myungho": { src: "/images/celebrities/park-myungho/hero-portrait.jpg", background: "#3c3229", desktopPosition: "50% 12%", mobilePosition: "50% 0%" },
};
