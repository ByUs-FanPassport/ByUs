import { z } from "zod";

export const creatorSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const creatorReactionStateSchema = z.object({
  slug: creatorSlugSchema,
  reacted: z.boolean(),
}).strict();

export const creatorReactionStatesSchema = z.array(creatorReactionStateSchema).max(50);

export const creatorReactionBatchSchema = z.object({
  states: z.record(creatorSlugSchema, z.object({ reacted: z.boolean() }).strict()),
}).strict();

export type CreatorReactionState = z.infer<typeof creatorReactionStateSchema>;

export function parseCreatorSlugList(url: URL): readonly string[] | null {
  const values = url.searchParams.getAll("slugs");
  if (values.length !== 1) return null;
  const raw = values[0]!.split(",");
  if (raw.length === 0 || raw.length > 50 || raw.some((slug) => !creatorSlugSchema.safeParse(slug).success)) return null;
  return [...new Set(raw)];
}

export function parseCompleteCreatorReactionBatch(value: unknown, requestedSlugs: readonly string[]): ReadonlyMap<string, boolean> {
  const parsed = creatorReactionBatchSchema.parse(value);
  const states = new Map<string, boolean>();
  for (const [slug, state] of Object.entries(parsed.states)) {
    states.set(slug, state.reacted);
  }
  if (states.size !== requestedSlugs.length || requestedSlugs.some((slug) => !states.has(slug))) {
    throw new Error("Incomplete creator reaction state");
  }
  return states;
}
