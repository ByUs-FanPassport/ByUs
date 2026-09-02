import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const signedTransactionSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);
const publicSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);

const preparedSubmissionSchema = z.object({
  txHash: hashSchema,
  signedTransaction: signedTransactionSchema,
}).strict();

const basePayload = z.object({
  recipient: addressSchema,
  celebritySlug: publicSlugSchema,
  workerSubmission: preparedSubmissionSchema.optional(),
});

export const passportPayloadV1Schema = basePayload.extend({
  passportId: bytes32Schema,
}).strict();

export const stampPayloadV1Schema = basePayload.extend({
  issuanceId: bytes32Schema,
  stampType: z.enum(["Knowledge", "Reservation", "Attendance", "Survey"]),
}).strict();

export const reactionPayloadV1Schema = basePayload.extend({
  issuanceId: bytes32Schema,
  reactionType: z.literal("FirstReaction"),
}).strict();

export type PreparedSubmission = z.infer<typeof preparedSubmissionSchema>;
export type PassportPayloadV1 = z.infer<typeof passportPayloadV1Schema>;
export type StampPayloadV1 = z.infer<typeof stampPayloadV1Schema>;
export type ReactionPayloadV1 = z.infer<typeof reactionPayloadV1Schema>;
export type JobPayload = PassportPayloadV1 | StampPayloadV1 | ReactionPayloadV1;
export type EntityType = "passport" | "stamp" | "reaction";

export interface BlockchainJob {
  id: string;
  entityType: EntityType;
  entityId: string;
  operationKey: string;
  payloadVersion: number;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  txHash: string | null;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export function parseJobPayload(job: BlockchainJob): JobPayload {
  if (job.payloadVersion !== 1) {
    throw new WorkerError("UNSUPPORTED_PAYLOAD_VERSION", `Unsupported payload version: ${job.payloadVersion}`, false);
  }
  if (job.entityType === "passport") return passportPayloadV1Schema.parse(job.payload);
  if (job.entityType === "reaction") return reactionPayloadV1Schema.parse(job.payload);
  return stampPayloadV1Schema.parse(job.payload);
}

export class WorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerError";
  }
}

export function classifyError(error: unknown): WorkerError {
  if (error instanceof WorkerError) return error;
  if (error instanceof z.ZodError) {
    return new WorkerError("INVALID_JOB_PAYLOAD", z.prettifyError(error), false, { cause: error });
  }
  return new WorkerError("UNEXPECTED_WORKER_ERROR", error instanceof Error ? error.message : String(error), true, { cause: error });
}
