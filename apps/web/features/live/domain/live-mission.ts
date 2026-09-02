import { z } from "zod";

const media = z.object({ type: z.enum(["image", "video"]), url: z.string().url() }).strict().nullable();
const option = z.object({ id: z.string().uuid(), label: z.string().min(1), media }).strict();
const question = z.object({ id: z.string().uuid(), text: z.string().min(1), media, options: z.array(option).min(2) }).strict();
export const liveMissionSchema = z.object({
  id: z.string().uuid(), type: z.enum(["quiz", "survey", "vote"]), version: z.number().int().positive(),
  title: z.string().min(1), description: z.string(), attendanceRequired: z.boolean(), completed: z.boolean(),
  questions: z.array(question).min(1),
}).strict();
export const liveMissionListSchema = z.array(liveMissionSchema);
export const submitLiveMissionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  answers: z.array(z.object({ questionId: z.string().uuid(), selectedOptionIds: z.array(z.string().uuid()).length(1) }).strict()).min(1),
}).strict();
export const liveMissionCompletionSchema = z.object({ mission: z.object({
  id: z.string().uuid(), type: z.enum(["quiz", "survey", "vote"]), completed: z.literal(true),
  correctness: z.boolean().nullable(), scorePoints: z.number().int().min(0).max(3), ticketAmount: z.number().int().min(0).max(2),
  stamp: z.object({ id: z.string().uuid(), businessStatus: z.string(), mintStatus: z.string() }).strict(),
}).strict() }).strict();

