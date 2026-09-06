/** Only the two public CMS buckets may use the shared image optimizer. */
export const publicImageRemotePatterns = [
  "gmrykvmtmuaeswpajteq.supabase.co",
  "xcppyedwusirqnfpbtit.supabase.co",
].map((hostname) => ({
  protocol: "https" as const,
  hostname,
  port: "",
  pathname: "/storage/v1/object/public/cms-assets/**",
  search: "",
}));

export function bypassImageOptimization(source: string): boolean {
  if (source.startsWith("/")) return false;
  try {
    const url = new URL(source);
    return !publicImageRemotePatterns.some((pattern) =>
      url.protocol === "https:" && url.hostname === pattern.hostname &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.startsWith("/storage/v1/object/public/cms-assets/"));
  } catch {
    return true;
  }
}

// These match the existing CSS transforms; DPR is chosen by the browser.
export function creatorCropScale(slug: string): number {
  return slug === "ifewknow" ? 2.45 : slug === "park-myungho" ? 1.9 : slug === "xin" ? 1.6 : 1;
}

export function homeHeroSizes(panelOpen: boolean): string {
  return panelOpen
    ? "(min-width: 1440px) 952px, (min-width: 1280px) calc(100vw - 488px), (min-width: 1024px) calc(100vw - 448px), (min-width: 768px) calc(100vw - 64px), calc(100vw - 32px)"
    : "(min-width: 1440px) 1360px, (min-width: 1280px) calc(100vw - 80px), (min-width: 768px) calc(100vw - 64px), calc(100vw - 32px)";
}
