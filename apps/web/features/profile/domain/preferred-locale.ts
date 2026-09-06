import { z } from "zod";

export const preferredLocaleSchema = z.enum(["ko", "en"]);

export type PreferredLocale = z.infer<typeof preferredLocaleSchema>;
