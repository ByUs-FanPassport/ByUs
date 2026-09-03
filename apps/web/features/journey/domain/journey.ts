import { z } from "zod";

const requirementStateSchema = z.enum(["complete", "incomplete"]);

const booleanRequirementSchema = z
  .object({
    required: z.boolean(),
    state: requirementStateSchema,
  })
  .strict();

export const journeyMissionRequirementSelectionSchema = z
  .object({
    missionId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const journeyRequirementSelectionSchema = z
  .object({
    requirePassport: z.boolean(),
    requireReservation: z.boolean(),
    requireAttendance: z.boolean(),
    missions: z.array(journeyMissionRequirementSelectionSchema),
    bonusTicketAmount: z.number().int().min(0).max(5),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      !selection.requirePassport &&
      !selection.requireReservation &&
      !selection.requireAttendance &&
      selection.missions.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "at least one Journey requirement is required",
      });
    }

    if (hasDuplicateJourneyMissionIds(selection.missions)) {
      context.addIssue({
        code: "custom",
        message: "duplicate Journey Mission",
        path: ["missions"],
      });
    }
  });

export function hasDuplicateJourneyMissionIds(
  missions: ReadonlyArray<{ missionId: string }>,
): boolean {
  return new Set(missions.map((mission) => mission.missionId)).size !== missions.length;
}

const journeyMissionStateSchema = journeyMissionRequirementSelectionSchema
  .extend({ state: requirementStateSchema })
  .strict();

export const journeyRequirementsSchema = z
  .object({
    passport: booleanRequirementSchema,
    reservation: booleanRequirementSchema,
    attendance: booleanRequirementSchema,
    missions: z.array(journeyMissionStateSchema),
  })
  .strict();

export const journeySnapshotSchema = z
  .object({
    liveEventId: z.string().uuid(),
    requirementRevisionId: z.string().uuid(),
    eligible: z.boolean(),
    complete: z.boolean(),
    requirements: journeyRequirementsSchema,
    bonusTicketAmount: z.number().int().min(0).max(5),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    ticketLedgerId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedEligible = [
      snapshot.requirements.passport,
      snapshot.requirements.reservation,
      snapshot.requirements.attendance,
    ].every(
      (requirement) =>
        !requirement.required || requirement.state === "complete",
    );
    const expectedComplete = areJourneyRequirementsComplete(snapshot.requirements);

    if (snapshot.eligible !== expectedEligible) {
      context.addIssue({ code: "custom", path: ["eligible"], message: "inconsistent Journey eligibility" });
    }
    if (snapshot.complete !== expectedComplete) {
      context.addIssue({ code: "custom", path: ["complete"], message: "inconsistent Journey completion" });
    }
    if (!snapshot.complete && (snapshot.completedAt !== null || snapshot.ticketLedgerId !== null)) {
      context.addIssue({ code: "custom", path: ["completedAt"], message: "incomplete Journey cannot have a reward" });
    }
    if (snapshot.completedAt === null && snapshot.ticketLedgerId !== null) {
      context.addIssue({ code: "custom", path: ["ticketLedgerId"], message: "unpersisted Journey cannot have a Ticket" });
    }
    if (snapshot.completedAt !== null && snapshot.bonusTicketAmount > 0 && snapshot.ticketLedgerId === null) {
      context.addIssue({ code: "custom", path: ["ticketLedgerId"], message: "persisted Journey reward is missing" });
    }
    if (snapshot.bonusTicketAmount === 0 && snapshot.ticketLedgerId !== null) {
      context.addIssue({ code: "custom", path: ["ticketLedgerId"], message: "zero bonus cannot have a Ticket" });
    }
  });

export const evaluateJourneyRequestSchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

export type JourneyRequirementSelection = z.infer<
  typeof journeyRequirementSelectionSchema
>;
export type JourneyRequirements = z.infer<typeof journeyRequirementsSchema>;
export type JourneySnapshot = z.infer<typeof journeySnapshotSchema>;
export type EvaluateJourneyRequest = z.infer<
  typeof evaluateJourneyRequestSchema
>;

export function areJourneyRequirementsComplete(
  requirements: JourneyRequirements,
): boolean {
  const scalarRequirements = [
    requirements.passport,
    requirements.reservation,
    requirements.attendance,
  ];

  return (
    scalarRequirements.every(
      (requirement) =>
        !requirement.required || requirement.state === "complete",
    ) &&
    requirements.missions.every((mission) => mission.state === "complete")
  );
}
