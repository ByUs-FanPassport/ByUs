import { z } from "zod";

export const adminDirectoryRoleSchema = z.enum(["admin", "operator", "viewer"]);
export const adminDirectoryEntrySchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  role: adminDirectoryRoleSchema,
  active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const adminDirectorySchema = z.object({
  items: z.array(adminDirectoryEntrySchema),
  actorId: z.uuid(),
});
export const createAdminDirectorySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  role: adminDirectoryRoleSchema.default("viewer"),
}).strict();
export const updateAdminDirectorySchema = z.object({
  id: z.uuid(),
  role: adminDirectoryRoleSchema,
  active: z.boolean(),
  // Keep PostgreSQL microseconds intact; never round-trip through Date.
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type AdminDirectoryEntry = z.infer<typeof adminDirectoryEntrySchema>;
export type AdminDirectory = z.infer<typeof adminDirectorySchema>;
export type CreateAdminDirectoryInput = z.infer<typeof createAdminDirectorySchema>;
export type UpdateAdminDirectoryInput = z.infer<typeof updateAdminDirectorySchema>;
