export const AVATAR_CHANGED_EVENT = "byus:avatar-changed";

type AvatarChangedDetail = { privyUserId: string };

export function notifyAvatarChanged(privyUserId: string) {
  window.dispatchEvent(
    new CustomEvent<AvatarChangedDetail>(AVATAR_CHANGED_EVENT, {
      detail: { privyUserId },
    }),
  );
}

export function subscribeAvatarChanged(
  privyUserId: string | undefined,
  listener: () => void,
) {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<AvatarChangedDetail>).detail;
    if (privyUserId && detail?.privyUserId === privyUserId) listener();
  };
  window.addEventListener(AVATAR_CHANGED_EVENT, handle);
  return () => window.removeEventListener(AVATAR_CHANGED_EVENT, handle);
}
