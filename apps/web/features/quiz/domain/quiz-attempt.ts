import { z } from "zod";

const uuidSchema = z.uuid();

const openAttemptSchema = z
  .object({
    id: uuidSchema,
    status: z.literal("open"),
    score: z.null(),
    submittedAt: z.null(),
  })
  .strict();

const failedAttemptSchema = z
  .object({
    id: uuidSchema,
    status: z.literal("failed"),
    score: z.union([z.literal(0), z.literal(1)]),
    submittedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const passedAttemptSchema = z
  .object({
    id: uuidSchema,
    status: z.literal("passed"),
    score: z.union([z.literal(2), z.literal(3)]),
    submittedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const quizAttemptResultSchema = z.discriminatedUnion("status", [
  openAttemptSchema,
  failedAttemptSchema,
  passedAttemptSchema,
]);

const quizOptionSchema = z
  .object({
    id: uuidSchema,
    position: z.number().int().positive(),
    label: z.string().trim().min(1).max(500),
  })
  .strict();

const quizQuestionSchema = z
  .object({
    id: uuidSchema,
    position: z.number().int().min(1).max(3),
    prompt: z.string().trim().min(1).max(1000),
    selectedOptionId: uuidSchema.nullable(),
    options: z.array(quizOptionSchema).min(2),
  })
  .strict()
  .superRefine((question, context) => {
    for (let index = 1; index < question.options.length; index += 1) {
      if (question.options[index - 1].position >= question.options[index].position) {
        context.addIssue({
          code: "custom",
          message: "quiz options must preserve ascending Admin source position",
          path: ["options", index, "position"],
        });
      }
    }
    if (
      question.selectedOptionId !== null &&
      !question.options.some((option) => option.id === question.selectedOptionId)
    ) {
      context.addIssue({
        code: "custom",
        message: "selected option must belong to its snapshot question",
        path: ["selectedOptionId"],
      });
    }
  });

const quizAttemptProjectionSchema = z
  .object({
    attempt: quizAttemptResultSchema,
    questions: z.array(quizQuestionSchema).length(3),
  })
  .strict()
  .superRefine((projection, context) => {
    projection.questions.forEach((question, index) => {
      if (question.position !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "quiz questions must preserve their one-time snapshot order",
          path: ["questions", index, "position"],
        });
      }
    });
  });

const quizStartProjectionSchema = z.union([
  z
    .object({
      kind: z.literal("holder"),
      passportId: uuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("attempt"),
      attempt: quizAttemptResultSchema,
      questions: z.array(quizQuestionSchema).length(3),
    })
    .strict()
    .superRefine((projection, context) => {
      projection.questions.forEach((question, index) => {
        if (question.position !== index + 1) {
          context.addIssue({
            code: "custom",
            message: "quiz questions must preserve their one-time snapshot order",
            path: ["questions", index, "position"],
          });
        }
      });
    }),
]);

const quizSubmitProjectionSchema = z.union([
  z
    .object({
      attempt: failedAttemptSchema,
      issuance: z.null(),
    })
    .strict(),
  z
    .object({
      attempt: passedAttemptSchema,
      issuance: z
        .object({
          passportId: uuidSchema,
          stampId: uuidSchema,
          scorePoints: z.literal(1),
        })
        .strict(),
    })
    .strict(),
]);

const quizAnswerInputSchema = z
  .object({
    questionId: uuidSchema,
    selectedOptionId: uuidSchema,
  })
  .strict();

export type QuizAttemptProjection = z.infer<typeof quizAttemptProjectionSchema>;
export type QuizStartProjection = z.infer<typeof quizStartProjectionSchema>;
export type QuizSubmitProjection = z.infer<typeof quizSubmitProjectionSchema>;
export type QuizAnswerInput = z.infer<typeof quizAnswerInputSchema>;
export type QuizAttemptStatus = z.infer<typeof quizAttemptResultSchema>["status"];

export function parseQuizAttemptProjection(value: unknown): QuizAttemptProjection {
  return quizAttemptProjectionSchema.parse(value);
}

export function parseQuizStartProjection(value: unknown): QuizStartProjection {
  return quizStartProjectionSchema.parse(value);
}

export function parseQuizSubmitProjection(value: unknown): QuizSubmitProjection {
  return quizSubmitProjectionSchema.parse(value);
}

export function parseQuizAnswerInput(value: unknown): QuizAnswerInput {
  return quizAnswerInputSchema.parse(value);
}
