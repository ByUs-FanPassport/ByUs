export const FAN_ACTIVITY_UPDATED = "byus:fan-activity-updated";

export type FanActivityResource = "summary" | "reactions" | "passports";

export function notifyFanActivityUpdated(ownerId: string | undefined, resources?: readonly FanActivityResource[]) {
  window.dispatchEvent(new CustomEvent(FAN_ACTIVITY_UPDATED, { detail: { ownerId, resources } }));
}

/** Return visits and same-owner mutations invalidate already-mounted fan views. */
export function subscribeFanActivityUpdates(ownerId: string | undefined, refresh: () => void, resource?: FanActivityResource) {
  const visible = () => { if (document.visibilityState !== "hidden") refresh(); };
  const updated = (event: Event) => {
    const detail = (event as CustomEvent<{ ownerId?: string; resources?: readonly FanActivityResource[] }>).detail;
    if (detail?.ownerId === ownerId && (!resource || !detail.resources || detail.resources.includes(resource))) visible();
  };
  window.addEventListener(FAN_ACTIVITY_UPDATED, updated);
  window.addEventListener("focus", visible);
  window.addEventListener("pageshow", visible);
  window.addEventListener("online", visible);
  document.addEventListener("visibilitychange", visible);
  return () => {
    window.removeEventListener(FAN_ACTIVITY_UPDATED, updated);
    window.removeEventListener("focus", visible);
    window.removeEventListener("pageshow", visible);
    window.removeEventListener("online", visible);
    document.removeEventListener("visibilitychange", visible);
  };
}
