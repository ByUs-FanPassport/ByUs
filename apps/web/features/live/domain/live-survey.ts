import { z } from "zod";

import { fanActivityCompletionSchema } from "./fan-activity-completion";

export const liveSurveyLocaleSchema = z.enum(["ko", "en"]);
export type LiveSurveyLocale = z.infer<typeof liveSurveyLocaleSchema>;

export const surveyQuestionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "rating_1_5",
  "free_text",
]);

const surveyOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(300),
  order: z.number().int().positive(),
}).strict();

const surveyQuestionSchema = z.object({
  id: z.string().uuid(),
  type: surveyQuestionTypeSchema,
  question: z.string().trim().min(1).max(1000),
  required: z.boolean(),
  order: z.number().int().positive(),
  options: z.array(surveyOptionSchema),
}).strict();

const surveyAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().uuid()).max(100).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  freeText: z.string().max(4000).optional(),
}).strict().superRefine((answer, context) => {
  const valueCount = Number(answer.selectedOptionIds !== undefined)
    + Number(answer.rating !== undefined)
    + Number(answer.freeText !== undefined);
  if (valueCount !== 1) {
    context.addIssue({ code: "custom", message: "exactly one answer value is required" });
  }
  if (answer.selectedOptionIds && new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length) {
    context.addIssue({ code: "custom", message: "selected options must be unique" });
  }
});

export const saveLiveSurveyDraftRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  answers: z.array(surveyAnswerSchema).max(100),
}).strict();

export const submitLiveSurveyRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  answers: z.array(surveyAnswerSchema).max(100),
}).strict();

export const liveSurveyResponseSchema = z.object({
  survey: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    questions: z.array(surveyQuestionSchema),
  }).strict(),
  eligibility: z.object({ completedAttendance: z.boolean() }).strict(),
  response: z.nullable(z.object({
    status: z.enum(["draft", "submitted"]),
    revision: z.number().int().nonnegative(),
    answers: z.array(surveyAnswerSchema),
    submittedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict()),
  completion: fanActivityCompletionSchema.nullable(),
}).strict().superRefine((value, context) => {
  const submitted = value.response?.status === "submitted";
  if (submitted !== (value.completion !== null)) {
    context.addIssue({
      code: "custom",
      message: "submitted survey completion is inconsistent",
    });
  }
  if (
    value.completion
    && (value.completion.earnedStamp.type !== "survey"
      || value.completion.scoreDelta !== 2)
  ) {
    context.addIssue({
      code: "custom",
      message: "survey completion is inconsistent",
    });
  }
});

export const saveLiveSurveyDraftResponseSchema = z.object({
  response: z.object({
    status: z.literal("draft"),
    revision: z.number().int().positive(),
    answers: z.array(surveyAnswerSchema),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const submitLiveSurveyResponseSchema = z.object({
  response: z.object({
    status: z.literal("submitted"),
    submittedAt: z.string().datetime({ offset: true }),
    activityId: z.string().uuid(),
    scorePoints: z.literal(2),
    stamp: z.object({
      id: z.string().uuid(),
      businessStatus: z.literal("issued"),
      mintStatus: z.enum(["queued", "processing", "retryable", "permanent_failure", "minted"]),
    }).strict(),
  }).strict(),
  completion: fanActivityCompletionSchema,
}).strict().superRefine((value, context) => {
  if (
    value.completion.earnedStamp.id !== value.response.stamp.id
    || value.completion.earnedStamp.type !== "survey"
    || value.completion.earnedStamp.mintStatus !== value.response.stamp.mintStatus
    || value.completion.scoreDelta !== value.response.scorePoints
  ) {
    context.addIssue({
      code: "custom",
      message: "survey completion is inconsistent",
    });
  }
});

export type SurveyAnswer = z.infer<typeof surveyAnswerSchema>;
export type LiveSurveyResponse = z.infer<typeof liveSurveyResponseSchema>;
export type SaveLiveSurveyDraftResponse = z.infer<typeof saveLiveSurveyDraftResponseSchema>;
export type SubmitLiveSurveyResponse = z.infer<typeof submitLiveSurveyResponseSchema>;

export function parseSurveyLocale(value: string): LiveSurveyLocale {
  return liveSurveyLocaleSchema.parse(value);
}

export function projectLiveSurvey(value: unknown): LiveSurveyResponse {
  return liveSurveyResponseSchema.parse(value);
}

export function projectSavedSurveyDraft(value: unknown): SaveLiveSurveyDraftResponse {
  return saveLiveSurveyDraftResponseSchema.parse(value);
}

export function projectSubmittedSurvey(value: unknown): SubmitLiveSurveyResponse {
  return submitLiveSurveyResponseSchema.parse(value);
}
