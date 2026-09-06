export function isPrivyAppleLoginEnabled(enabled: string | undefined): boolean {
  return enabled === "true";
}

export function readPublicPrivyAppleLoginPolicy(): boolean {
  return isPrivyAppleLoginEnabled(process.env.NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED);
}
