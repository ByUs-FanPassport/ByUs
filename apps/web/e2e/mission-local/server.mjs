// Standalone, loopback-only mission UI harness. It renders the production
// LiveMissionScreen and replaces only Privy plus the list/detail/submit APIs.
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
const archivePath = path.join(here, "elina-public-fixture.json");
const host = "127.0.0.1";
const defaultPort = 4186;
const slug = "elina-banksy-instagram-20260918";
const supportedScenarios = new Set(["fresh", "wrong-quiz", "already-completed", "retry"]);

const questionIds = {
  "4067a4ba-5874-4e2a-b100-d030f60ebaac": "41000000-0000-4000-8000-000000000001",
  "2d83ca88-1768-4ab7-85af-2a6e595e5490": "41000000-0000-4000-8000-000000000002",
};
const optionIds = {
  "4067a4ba-5874-4e2a-b100-d030f60ebaac": [
    "42000000-0000-4000-8000-000000000001",
    "42000000-0000-4000-8000-000000000002",
    "42000000-0000-4000-8000-000000000003",
  ],
  "2d83ca88-1768-4ab7-85af-2a6e595e5490": [
    "42000000-0000-4000-8000-000000000011",
    "42000000-0000-4000-8000-000000000012",
    "42000000-0000-4000-8000-000000000013",
    "42000000-0000-4000-8000-000000000014",
  ],
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function scenarioFromAuthorization(value) {
  const match = /^Bearer mission-local-testowner:(.+)$/.exec(value ?? "");
  if (!match || !supportedScenarios.has(match[1])) return null;
  return match[1];
}

function missionDto(source, completed) {
  return {
    id: source.id,
    type: source.type,
    version: source.version,
    title: source.title,
    description: source.description,
    attendanceRequired: source.attendanceRequired,
    completed,
    visibleFrom: source.visibleFrom,
    visibleUntil: source.visibleUntil,
    questions: [{
      id: questionIds[source.id],
      text: source.question,
      media: source.questionImageUrl ? { type: "image", url: source.questionImageUrl } : null,
      options: source.options.map((option, index) => ({
        id: optionIds[source.id][index],
        label: option.label,
        displayMode: option.displayMode,
        media: option.imageUrl ? { type: "image", url: option.imageUrl } : null,
      })),
    }],
  };
}

function liveEvent(locale) {
  const ko = locale === "ko";
  return {
    live: {
      id: "c0960f8b-f01c-4308-97f8-3d13173922e8",
      slug,
      effectiveStatus: "scheduled",
      startsAt: "2026-09-18T10:00:00+00:00",
      endsAt: "2026-09-18T11:00:00+00:00",
      reservationOpensAt: "2026-09-11T00:00:00+00:00",
      reservationClosesAt: "2026-09-18T09:30:00+00:00",
      title: ko ? "엘리나와 함께하는 뱅크시 전시 LIVE" : "Banksy Exhibition LIVE with Elina",
      description: ko ? "엘리나와 함께 뱅크시 작품을 만나보세요." : "Discover Banksy artworks with Elina.",
      productContext: ko ? "Instagram LIVE 참여" : "Instagram LIVE participation",
      heroImage: { url: "/images/guest-home/elina-card.jpg", alt: ko ? "엘리나" : "Elina" },
      celebrity: {
        slug: "elina",
        name: ko ? "엘리나" : "Elina",
        image: "/images/guest-home/elina-card.jpg",
        fanCount: 0,
      },
      brand: {
        slug: "byus",
        name: "ByUs",
        logo: "/images/guest-home/byus-wordmark.svg",
        websiteUrl: "https://byus.kr",
      },
      watch: { available: false, mode: "unavailable", provider: "instagram", url: "https://www.instagram.com/elina_4_22/" },
      missionsAvailable: true,
    },
    viewer: { authenticated: true, passport: "active", reservation: null },
    primaryAction: "reserve",
  };
}

export async function startHarness({ port = defaultPort } = {}) {
  const origin = `http://${host}:${port}`;
  const archive = JSON.parse(await readFile(archivePath, "utf8"));
  const reward = {
    scorePoints: archive.reward.current.missionScore,
    ticketAmount: archive.reward.current.missionTicket,
  };
  const submissionLog = [];
  const retryAttempts = new Map();
  const aliases = [
    { find: "@", replacement: web },
    ...["next/link", "next/image", "next/navigation", "@privy-io/react-auth", "server-only"].map((name) => ({
      find: name,
      replacement: path.join(here, {
        "next/link": "next-link.tsx",
        "next/image": "next-image.tsx",
        "next/navigation": "next-navigation.ts",
        "@privy-io/react-auth": "privy.ts",
        "server-only": "server-only.ts",
      }[name]),
    })),
  ];

  let handleApi;
  const vite = await createServer({
    plugins: [{
      name: "mission-local-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => handleApi ? handleApi(req, res, next) : next());
      },
    }],
    configFile: false,
    root: here,
    publicDir: path.join(web, "public"),
    cacheDir: path.join(web, "node_modules/.vite-mission-local"),
    resolve: { alias: aliases },
    server: { host, port, strictPort: true, fs: { allow: [web, path.resolve(web, "../../node_modules")] } },
    ssr: { noExternal: ["server-only"] },
  });

  handleApi = async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    if (req.headers.host !== `${host}:${port}` || (req.headers.origin && req.headers.origin !== origin)) {
      res.statusCode = 403;
      res.end();
      return;
    }

    const request = new Request(`${origin}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method ?? "GET") ? {} : { body: Readable.toWeb(req), duplex: "half" }),
    });
    const url = new URL(request.url);
    const locale = url.searchParams.get("locale") === "en" ? "en" : "ko";
    const scenario = scenarioFromAuthorization(request.headers.get("authorization"));
    let response;

    if (request.method === "GET" && url.pathname === `/api/live-events/${slug}`) {
      response = json(liveEvent(locale));
    } else if (request.method === "GET" && url.pathname === `/api/live-events/${slug}/missions`) {
      if (!scenario) response = json({ code: "UNAUTHENTICATED" }, 401);
      else {
        const source = archive.authenticatedFanRead[locale].missions;
        response = json(source.map((mission) => missionDto(mission, scenario === "already-completed")));
      }
    } else {
      const match = /^\/api\/missions\/([0-9a-f-]+)\/submit$/.exec(url.pathname);
      if (request.method !== "POST" || !match) response = json({ code: "NOT_FOUND" }, 404);
      else if (!scenario) response = json({ code: "UNAUTHENTICATED" }, 401);
      else {
        const mission = [...archive.authenticatedFanRead.ko.missions, ...archive.authenticatedFanRead.en.missions]
          .find((candidate) => candidate.id === match[1]);
        if (!mission) response = json({ code: "NOT_FOUND" }, 404);
        else {
          const body = await request.json();
          submissionLog.push({ scenario, missionId: mission.id, idempotencyKey: body.idempotencyKey, answers: body.answers });
          const retryKey = `${scenario}:${mission.id}`;
          const attempt = (retryAttempts.get(retryKey) ?? 0) + 1;
          retryAttempts.set(retryKey, attempt);
          if (scenario === "retry" && attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            response = json({ code: "TEMPORARY_FAILURE" }, 503);
          }
          else {
            const isQuiz = mission.type === "quiz";
            const wrong = scenario === "wrong-quiz" && isQuiz;
            response = json({ mission: {
              id: mission.id,
              type: mission.type,
              completed: true,
              correctness: isQuiz ? !wrong : null,
              scorePoints: reward.scorePoints,
              ticketAmount: reward.ticketAmount,
              stamp: {
                id: isQuiz ? "43000000-0000-4000-8000-000000000002" : "43000000-0000-4000-8000-000000000001",
                businessStatus: "recorded",
                mintStatus: "queued",
              },
            } });
          }
        }
      }
    }

    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  };

  await vite.listen();
  return { vite, baseURL: origin, submissionLog, fixture: { archivePath, reward, slug } };
}
