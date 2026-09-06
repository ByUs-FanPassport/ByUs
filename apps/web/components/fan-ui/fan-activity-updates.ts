export const FAN_ACTIVITY_UPDATED = "byus:fan-activity-updated";

export function notifyFanActivityUpdated(ownerId: string | undefined) {
  window.dispatchEvent(new CustomEvent(FAN_ACTIVITY_UPDATED, { detail: { ownerId } }));
}

/** Return visits and same-owner mutations invalidate already-mounted fan views. */
export function subscribeFanActivityUpdates(ownerId: string | undefined, refresh: () => void) {
  const visible = () => { if (document.visibilityState !== "hidden") refresh(); };
  const updated = (event: Event) => {
    const sourceOwner = (event as CustomEvent<{ ownerId?: string }>).detail?.ownerId;
    if (sourceOwner === ownerId) visible();
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
