type ResponseHeader = { key: string; value: string };

const privyFrameSources = [
  "https://auth.privy.io",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
];

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next emits inline bootstrap scripts. Removing unsafe-inline requires a
  // request-scoped nonce architecture; keep the exception isolated here.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  // Published CMS records intentionally support administrator-approved HTTPS
  // artwork. data/blob are required by Privy's documented client integration.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `child-src ${privyFrameSources.join(" ")}`,
  `frame-src ${[...privyFrameSources, "https://challenges.cloudflare.com"].join(" ")}`,
  [
    "connect-src 'self'",
    "https://auth.privy.io",
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
    "wss://www.walletlink.org",
    "https://*.rpc.privy.systems",
    "https://explorer-api.walletconnect.com",
  ].join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
].join("; ");

export const responseSecurityHeaders: ResponseHeader[] = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Google/Privy authentication uses a popup and must retain its opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];
