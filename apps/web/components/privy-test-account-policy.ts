export interface PublicPrivyTestAccountPolicySource {
  appUrl: string | undefined;
  appEnvironment: string | undefined;
  enabled: string | undefined;
}

export function isPrivyTestAccountLoginEnabled(
  source: PublicPrivyTestAccountPolicySource,
): boolean {
  if (source.enabled !== "true" || source.appEnvironment !== "development") return false;
  try {
    const hostname = new URL(source.appUrl ?? "").hostname.toLowerCase();
    return hostname !== "byus.kr" && hostname !== "www.byus.kr";
  } catch {
    return false;
  }
}

export function readPublicPrivyTestAccountPolicy(): boolean {
  return isPrivyTestAccountLoginEnabled({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    appEnvironment: process.env.NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT,
    enabled: process.env.NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
  });
}
