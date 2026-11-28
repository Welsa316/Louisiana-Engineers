/**
 * Shapes of the scheduling endpoints (Task 30, migration 0014):
 *
 * - `GET  /api/relationships/:requestId/slots`     the relationship's proposed times
 * - `POST /api/relationships/:requestId/slots`     propose one to three times
 * - `GET  /api/relationships/:requestId/meetings`  the relationship's meetings
 * - `POST /api/relationships/:requestId/meetings`  choose a proposed time
 * - `GET  /api/meetings?when=upcoming|past`        the caller's meetings log, both roles
 * - `POST /api/meetings/:id/cancel`                cancel a meeting that has not started
 * - `POST /api/meetings/:id/outcome`               "Did you meet?"
 *
 * `:requestId` is the accepted request's id, as everywhere else. Only the two
 * parties of the relationship read or act; anyone else gets 404. The other
 * party appears by name only. Times are ISO strings (UTC); the screens show
 * them in Louisiana time.
 */

import type { MeetingMode, Paged, RequestKind } from "./common";
import type { RequestRole } from "./requests";

export const slotStatuses = ["proposed", "chosen", "declined", "withdrawn"] as const;
export type SlotStatus = (typeof slotStatuses)[number];

export const meetingStatuses = ["upcoming", "completed", "canceled"] as const;
export type MeetingStatus = (typeof meetingStatuses)[number];

/** A meeting is held online or in person; `either` is a request preference, not a meeting mode. */
export const meetingModesHeld = ["online", "in-person"] as const satisfies readonly MeetingMode[];
export type MeetingModeHeld = (typeof meetingModesHeld)[number];

/** One proposed time. `proposedBy` is from the caller's point of view. */
export interface Slot {
  id: string;
  /** The proposal it came in with; choosing one declines the rest of it. */
  batchId: string;
  proposedBy: "me" | "them";
  startsAt: string;
  endsAt: string;
  durationMin: number;
  status: SlotStatus;
  createdAt: string;
}

/** `GET /api/relationships/:requestId/slots?status&page&size`: open proposals first, then the rest, newest first. */
export type SlotsResponse = Paged<Slot>;

/** `POST /api/relationships/:requestId/slots` (201): the new proposal's times. */
export interface ProposeTimesResponse {
  batchId: string;
  items: Slot[];
}

export interface MeetingCounterparty {
  firstName: string | null;
  lastName: string | null;
  /** The account was deleted; the names read "Former member". */
  former: boolean;
}

/** One meeting, as either party sees it. */
export interface Meeting {
  id: string;
  /** The request (and so the relationship card) it belongs to. */
  requestId: string;
  role: RequestRole;
  kind: RequestKind;
  topicLabel: string | null;
  counterparty: MeetingCounterparty;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  mode: MeetingModeHeld;
  place: string;
  agenda: string;
  status: MeetingStatus;
  createdBy: "me" | "them";
  /** The latest "Did you meet?" answer, from either party; null while unanswered. */
  met: boolean | null;
  outcomeBy: "me" | "them" | null;
  outcomeAt: string | null;
  canceledBy: "me" | "them" | null;
  canceledAt: string | null;
  /** The meeting has started, was not canceled and nobody has said whether it happened. */
  awaitingOutcome: boolean;
  createdAt: string;
}

/** `GET /api/relationships/:requestId/meetings?status&page&size`, newest first. */
export type MeetingsResponse = Paged<Meeting>;

/**
 * `GET /api/meetings?when&page&size`: `upcoming` is meetings still to come
 * (soonest first); `past` is every other meeting (most recent first).
 */
export const meetingLogScopes = ["upcoming", "past"] as const;
export type MeetingLogScope = (typeof meetingLogScopes)[number];
export type MeetingLogResponse = Paged<Meeting>;

/**
 * `409` codes the scheduling actions answer. `403 { code: 'forbidden' }`
 * means choosing one's own proposed time.
 */
export type MeetingActionErrorCode =
  | "not_active"
  | "invalid_slots"
  | "slot_unavailable"
  | "slot_past"
  | "invalid_mode"
  | "invalid_meeting"
  | "not_upcoming"
  | "meeting_started"
  | "meeting_canceled"
  | "meeting_not_started"
  | "invalid_outcome";

/** In the personal data export: a meeting of either role. */
export interface ExportMeeting {
  requestId: string;
  role: RequestRole;
  /** The other party's display name. */
  counterparty: string;
  startsAt: string;
  durationMin: number;
  mode: MeetingModeHeld;
  place: string;
  agenda: string;
  status: MeetingStatus;
  createdBy: "me" | "them";
  met: boolean | null;
  canceledAt: string | null;
}

/** In the personal data export: a proposed time of either party. */
export interface ExportSlot {
  requestId: string;
  role: RequestRole;
  counterparty: string;
  proposedBy: "me" | "them";
  startsAt: string;
  endsAt: string;
  status: SlotStatus;
  createdAt: string;
}
