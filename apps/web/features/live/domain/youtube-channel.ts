export type YouTubeChannelTarget = Readonly<{ kind: "id" | "handle"; value: string }>;

/** Channel URLs opt in to discovery; a specific video always remains authoritative. */
export function parseYouTubeChannelUrl(value: string): YouTubeChannelTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com"].includes(url.hostname) ||
        url.username || url.password || url.port || url.hash || url.search) return null;
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    const id = /^\/channel\/(UC[A-Za-z0-9_-]{22})$/.exec(path)?.[1];
    if (id) return { kind: "id", value: id };
    const handle = /^\/@([\p{L}\p{N}_.·-]{1,30})$/u.exec(path)?.[1];
    return handle ? { kind: "handle", value: handle.toLowerCase() } : null;
  } catch {
    return null;
  }
}
