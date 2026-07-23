import { z } from "zod";

const safeImageUrl = z.string().min(1).refine((value) => value.startsWith("/") || value.startsWith("https://"));

export const mySummarySchema = z.object({
  profile: z.object({ nickname: z.string().nullable() }),
  passports: z.array(z.object({
    id: z.uuid(),
    celebrity: z.object({ slug: z.string(), name: z.string(), image: safeImageUrl }),
    issuedAt: z.iso.datetime({ offset: true }),
    stampCount: z.number().int().nonnegative(),
  })),
  reservations: z.array(z.object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    status: z.enum(["scheduled", "live"]),
    celebrity: z.object({ name: z.string(), image: safeImageUrl }),
  })),
  availableBenefitCount: z.number().int().nonnegative(),
  unreadNotificationCount: z.number().int().nonnegative(),
});

export type MySummary = z.infer<typeof mySummarySchema>;
