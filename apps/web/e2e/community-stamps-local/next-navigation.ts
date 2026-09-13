export const useRouter = () => ({ push: (url: string) => { window.location.assign(url); } });
