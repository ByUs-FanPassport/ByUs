import { AuthError } from "@/features/auth/domain/auth-errors";
import { mySummarySchema } from "@/features/my/domain/my-summary";
import { loadServerEnv } from "@/server/config/env";
import { createBenefitRouteDependencies } from "@/server/g4/benefit-route-dependencies";
import { createPassportReadRouteDependencies } from "@/server/g4/passport-read-route-dependencies";
import { createLiveEventRouteDependencies } from "@/server/g3/live-event-route-dependencies";
import { createNotificationRouteDependencies } from "@/server/notification/notification-route-dependencies";
import { createSupabaseProfileRepository } from "@/server/profile/profile-repository";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", vary: "Authorization" } as const;

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "ko";
  try {
    const passportDependencies = createPassportReadRouteDependencies();
    const fan = await passportDependencies.authorize(authorization);
    const environment = loadServerEnv();
    const profileRepository = createSupabaseProfileRepository({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    });
    const liveRepository = createLiveEventRouteDependencies().repository;
    const benefitRepository = createBenefitRouteDependencies().repository;
    const notificationRepository = createNotificationRouteDependencies().repository;
    const now = new Date();
    const [profile, passports, catalog, notifications] = await Promise.all([
      profileRepository.get(fan.appUserId),
      passportDependencies.repository.findCollection({ appUserId: fan.appUserId, locale }),
      liveRepository.listPublishedCatalog({ locale, appUserId: fan.appUserId, now }),
      notificationRepository.list({ appUserId: fan.appUserId, locale }),
    ]);
    const benefitLists = await Promise.all(
      passports.map((passport) => benefitRepository.list({
        celebritySlug: passport.celebrity.slug,
        locale,
        appUserId: fan.appUserId,
        now,
      })),
    );
    const activeReservations = [...catalog.liveNow, ...catalog.upcoming]
      .filter((item): item is NonNullable<typeof item> => item !== null && item.viewer.reservation !== null)
      .sort((left, right) => Date.parse(left.live.startsAt) - Date.parse(right.live.startsAt));
    const result = mySummarySchema.parse({
      profile: { nickname: profile.nickname },
      passports: [...passports]
        .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))
        .map((passport) => ({
          id: passport.id,
          celebrity: {
            slug: passport.celebrity.slug,
            name: passport.celebrity.name,
            image: passport.celebrity.image.url,
          },
          issuedAt: passport.issuedAt,
          stampCount: passport.stampSummary.total,
        })),
      reservations: activeReservations.map((item) => ({
        id: item.live.id,
        slug: item.live.slug,
        title: item.live.title,
        startsAt: item.live.startsAt,
        status: item.live.effectiveStatus,
        celebrity: { name: item.live.celebrity.name, image: item.live.celebrity.image },
      })),
      availableBenefitCount: benefitLists.flatMap(({ benefits }) => benefits)
        .filter(({ state }) => state === "eligible").length,
      unreadNotificationCount: notifications.filter(({ readAt }) => readAt === null).length,
    });
    return Response.json({ summary: result }, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: error.status, headers });
    }
    return Response.json({ error: { code: "MY_SUMMARY_UNAVAILABLE" } }, { status: 503, headers });
  }
}
