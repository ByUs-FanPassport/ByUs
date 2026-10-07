import { z } from "zod";

export const rsvpAttendeeSchema = z.object({
  id: z.uuid(),
  koreanName: z.string().min(1).max(80),
  englishName: z.string().min(1).max(80),
  affiliation: z.string().min(1).max(120),
  occupation: z.string().min(1).max(120),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  email: z.email().max(254),
  nationality: z.string().regex(/^[A-Z]{2}$/),
  createdAt: z.iso.datetime({ offset: true }),
});
export const rsvpAttendeesSchema = z.object({ attendees: z.array(rsvpAttendeeSchema) });
export type RsvpAttendee = z.infer<typeof rsvpAttendeeSchema>;
