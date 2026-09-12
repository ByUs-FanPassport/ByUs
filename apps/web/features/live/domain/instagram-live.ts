import { z } from "zod";

const instagramUsernamePattern = /^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/;
const instagramIdPattern = /^\d{1,30}$/;
const reservedProfileNames = new Set([
  "about",
  "accounts",
  "api",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "graphql",
  "legal",
  "p",
  "press",
  "privacy",
  "reel",
  "reels",
  "stories",
  "terms",
  "tv",
  "web",
]);

function safeInstagramUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.href === value &&
      url.protocol === "https:" &&
      ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
      ? url
      : null;
  } catch {
    return null;
  }
}

export function parseCanonicalInstagramProfileUrl(value: string): string | null {
  const url = safeInstagramUrl(value);
  if (!url || url.pathname.includes("//")) return null;
  const username = /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(url.pathname)?.[1]?.toLowerCase();
  return username &&
    instagramUsernamePattern.test(username) &&
    !username.includes("..") &&
    !reservedProfileNames.has(username)
    ? username
    : null;
}

export function parseInstagramLivePermalink(value: string, username: string): string | null {
  const owner = username.toLowerCase();
  if (!instagramUsernamePattern.test(owner) || owner.includes("..")) return null;
  const url = safeInstagramUrl(value);
  if (!url || url.pathname.includes("//")) return null;
  const match = /^\/stories\/([A-Za-z0-9._]{1,30})\/(\d{1,30})\/?$/.exec(url.pathname);
  return match && match[1].toLowerCase() === owner && instagramIdPattern.test(match[2])
    ? url.href
    : null;
}

const observedAtSchema = z.iso.datetime({ offset: true });
const usernameSchema = z.string().regex(instagramUsernamePattern).refine((value) => !value.includes(".."));
const offlineObservationSchema = z.object({
  state: z.literal("offline"),
  observedAt: observedAtSchema,
}).strict();
const unavailableObservationSchema = z.object({
  state: z.literal("unavailable"),
  observedAt: observedAtSchema,
}).strict();
const liveObservationSchema = z.object({
  state: z.literal("live"),
  observedAt: observedAtSchema,
  userId: z.string().regex(instagramIdPattern),
  username: usernameSchema,
  mediaId: z.string().regex(instagramIdPattern),
  actualStartTime: observedAtSchema,
  permalink: z.string(),
}).strict().superRefine((value, context) => {
  if (parseInstagramLivePermalink(value.permalink, value.username) !== value.permalink) {
    context.addIssue({ code: "custom", path: ["permalink"], message: "unsafe Instagram LIVE permalink" });
  }
});

export const instagramLiveObservationSchema = z.union([
  liveObservationSchema,
  offlineObservationSchema,
  unavailableObservationSchema,
]);

export type InstagramLiveObservation = z.infer<typeof instagramLiveObservationSchema>;
