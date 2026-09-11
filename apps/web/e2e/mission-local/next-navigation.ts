const router = {
  push: (url: string) => location.assign(url),
  replace: (url: string) => location.replace(url),
  refresh: () => location.reload(),
};

export const useRouter = () => router;
export const usePathname = () => location.pathname;
export const useSearchParams = () => new URLSearchParams(location.search);
