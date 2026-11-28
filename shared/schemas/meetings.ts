/**
 * Scheduling: proposing times, choosing one, and "Did you meet?"
 * (Task 30). The SQL functions re-check everything that depends on the
 * clock or stored state (future times, the relationship being active, the
 * slot still being open).
 */

import { z } from "zod";
import { fieldLimits } from "../limits";
import { meetingModesHeld } from "../types/meetings";
import { chars, optionalField, uuidSchema } from "./common";

const MINUTE = 60_000;

const isoInstant = z.string().datetime({ offset: true });

/** One proposed time: 15 to 180 minutes. */
export const slotInputSchema = z
  .object({ startsAt: isoInstant, endsAt: isoInstant })
  .superRefine((slot, ctx) => {
    const minutes = (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / MINUTE;
    if (!(minutes >= fieldLimits.slotMinutes.min && minutes <= fieldLimits.slotMinutes.max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: `A time is ${fieldLimits.slotMinutes.min} to ${fieldLimits.slotMinutes.max} minutes long`,
      });
    }
  });
export type SlotInput = z.output<typeof slotInputSchema>;

/** `POST /api/relationships/:requestId/slots`: one to three different times. */
export const proposeTimesSchema = z
  .object({
    slots: z.array(slotInputSchema).min(fieldLimits.slotsPerProposal.min).max(fieldLimits.slotsPerProposal.max),
  })
  .superRefine((body, ctx) => {
    const starts = body.slots.map((s) => Date.parse(s.startsAt));
    if (new Set(starts).size !== starts.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots"], message: "Propose different times" });
    }
  });
export type ProposeTimes = z.output<typeof proposeTimesSchema>;

/** `POST /api/relationships/:requestId/meetings`: choose one of the other party's times. */
export const chooseTimeSchema = z.object({
  slotId: uuidSchema,
  mode: z.enum(meetingModesHeld),
  place: optionalField(chars(fieldLimits.meetingPlace)),
  agenda: optionalField(chars(fieldLimits.meetingAgenda)),
});
export type ChooseTime = z.output<typeof chooseTimeSchema>;

/** `POST /api/meetings/:id/outcome`. */
export const meetingOutcomeSchema = z.object({ met: z.boolean() });
export type MeetingOutcome = z.output<typeof meetingOutcomeSchema>;
