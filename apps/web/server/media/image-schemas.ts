import { z } from "zod";
import { imageSlots, type ImageRoleRecord, type PhotoFrame, type PhotoSet, type PublicImageAsset } from "../../features/media/domain/public-image";

export const ownerTypeSchema = z.enum(["celebrity", "live"]);
export const roleSchema = z.enum(["profile", "portrait", "landscape", "poster"]);
export const imageSlotSchema = z.enum(Object.keys(imageSlots) as [keyof typeof imageSlots, ...(keyof typeof imageSlots)[]]);
export const publicImageAssetSchema: z.ZodType<PublicImageAsset> = z.object({
  id: z.uuid(), url: z.url().startsWith("https://"), width: z.number().int().positive(),
  height: z.number().int().positive(), mimeType: z.string().min(1), revision: z.number().int().positive(),
}).strict();
export const photoFrameSchema: z.ZodType<PhotoFrame> = z.object({
  fit: z.enum(["contain", "cover"]), x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  approvedAssetRevision: z.number().int().positive().nullable(),
}).strict();
export const imageRoleRecordSchema: z.ZodType<ImageRoleRecord> = z.object({
  role: roleSchema,
  revision: z.number().int().positive(),
  binding: z.object({
    asset: publicImageAssetSchema,
    alt: z.object({ ko: z.string().trim().min(1).max(300), en: z.string().trim().min(1).max(300) }).strict(),
    frames: z.partialRecord(imageSlotSchema, photoFrameSchema),
    revision: z.number().int().positive(),
  }).strict().nullable(),
}).strict().refine(value => value.binding === null || value.binding.revision === value.revision, "binding revision mismatch");

export const imageRoleWriteSchema = z.object({
  ownerType: ownerTypeSchema,
  ownerId: z.uuid(),
  role: roleSchema,
  expectedRevision: z.number().int().min(0),
  binding: z.object({
    assetId: z.uuid(),
    alt: z.object({ ko: z.string().trim().min(1).max(300), en: z.string().trim().min(1).max(300) }).strict(),
    frames: z.partialRecord(imageSlotSchema, photoFrameSchema),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const allowedRoles = value.ownerType === "celebrity" ? ["profile", "portrait", "landscape"] : ["landscape", "portrait", "poster"];
  if (!allowedRoles.includes(value.role)) context.addIssue({ code: "custom", path: ["role"], message: "role does not match owner" });
  if (!value.binding) return;
  for (const [slot, frame] of Object.entries(value.binding.frames)) {
    if (imageSlots[slot as keyof typeof imageSlots].role !== value.role || (value.ownerType === "live") !== slot.startsWith("event.")) {
      context.addIssue({ code: "custom", path: ["binding", "frames", slot], message: "slot does not match owner role" });
    }
    if (frame.fit === "cover" && frame.approvedAssetRevision === null) {
      context.addIssue({ code: "custom", path: ["binding", "frames", slot, "approvedAssetRevision"], message: "cover requires approval" });
    }
    if (frame.fit === "contain" && frame.approvedAssetRevision !== null) {
      context.addIssue({ code: "custom", path: ["binding", "frames", slot, "approvedAssetRevision"], message: "contain cannot approve cover" });
    }
  }
});

export function recordsToPhotoSet(records: readonly ImageRoleRecord[]): PhotoSet {
  const photos: PhotoSet = {};
  for (const record of records) photos[record.role] = record.binding;
  return photos;
}
