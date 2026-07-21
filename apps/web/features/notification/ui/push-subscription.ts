export type PushEnableResult =
  "subscribed" | "denied" | "unsupported" | "failed";
function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = window.atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export async function enablePushNotifications(
  getAccessToken: () => Promise<string | null>,
): Promise<PushEnableResult> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  if (!publicKey) return "failed";
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      }));
    const token = await getAccessToken();
    if (!token) return "failed";
    const response = await fetch("/api/notifications/subscriptions", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(subscription.toJSON()),
    });
    return response.ok ? "subscribed" : "failed";
  } catch {
    return "failed";
  }
}
