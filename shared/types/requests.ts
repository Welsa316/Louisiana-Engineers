/**
 * Shapes of the mentorship request endpoints (`/api/requests/*`,
 * `/api/mentors/:id/availability`, `/api/me/mentorship`,
 * `/api/me/suggested-mentors`, Task 19). A request is read only by its two
 * parties. The other party appears with public fields only; a student
 * mentee's program and goals reach the mentor only while the request is
 * open. Contact values appear only in `handoff`, only for the mentee of an
 * accepted request.
 */

import type { AudienceId, ContactMethodId } from "../taxonomy";
import type {
  DeclineReason,
  MeetingMode,
  MentorStatus,
  Paged,
  ProfileKind,
  RequestFormat,
  RequestKind,
  RequestStatus,
} from "./common";
import type { DirectoryEntry } from "./directory";
import type { ContactValue } from "./profiles";

/** Which side of a request the caller is on. */
export const requestRoles = ["mentee", "mentor"] as const;
export type RequestRole = (typeof requestRoles)[number];

/** The other party of a request, as either side may see them. */
export interface RequestCounterparty {
  id: string;
  kind: ProfileKind | null;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  /** Professionals only. */
  title: string | null;
  organization: string | null;
  /** The account was deleted; the names read "Former member". */
  former: boolean;
}

/** One row of `GET /api/requests`. No free text: that is in the detail. */
export interface RequestSummary {
  id: string;
  role: RequestRole;
  kind: RequestKind;
  status: RequestStatus;
  /** null for an introduction */
  topicId: string | null;
  topicLabel: string | null;
  counterparty: RequestCounterparty;
  format: RequestFormat;
  mode: MeetingMode;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  /** Set once the relationship is marked completed. */
  completedAt: string | null;
}

/** `GET /api/requests?role=mentee|mentor&status&page&size`. */
export type RequestsResponse = Paged<RequestSummary>;

/** What a mentor sees of a student mentee while the request is open. */
export interface MenteeDetails {
  program: string;
  level: AudienceId;
  institution: string;
  goals: string;
  interests: string[];
  topicsNeeded: string[];
}

export interface RequestRelationship {
  startedAt: string;
  completedAt: string | null;
  /** Who marked it completed, from the caller's point of view. */
  completedBy: "me" | "them" | null;
  /** The method names the mentor handed over (values only in `handoff`). */
  sharedMethods: Exclude<ContactMethodId, "mest">[];
}

/** `GET /api/requests/:id`, and the answer to every request action. */
export interface RequestDetail extends RequestSummary {
  why: string;
  goals: string | null;
  schedulingNote: string | null;
  mentorNote: string | null;
  declineReason: DeclineReason | null;
  /** The text was emptied by the retention rule or a deletion. */
  textPurged: boolean;
  /** Only while accepted or completed. */
  relationship: RequestRelationship | null;
  /** The mentor's view of a student mentee, while the request is open; null otherwise. */
  mentee: MenteeDetails | null;
  /** The mentee of an accepted request only: how to reach the mentor. */
  handoff?: { methods: ContactValue[] };
}

/**
 * `409` codes the request actions answer besides the creation refusals in
 * `DomainErrorCode` (shared/types/common.ts). `403 { code: 'forbidden' }`
 * means the other party's action (a mentor canceling, a mentee answering).
 */
export type RequestActionErrorCode =
  | "not_pending"
  | "not_active"
  | "invalid_share_methods"
  | "invalid_decline_reason"
  | "invalid_request"
  | "not_onboarded";

/** `GET /api/mentors/:id/availability`, decided in this order. */
export const availabilityStates = ["off", "networking_only", "paused", "full", "taking"] as const;
export type AvailabilityState = (typeof availabilityStates)[number];

export interface MentorAvailability {
  state: AvailabilityState;
  /** ISO date; only for `paused` with a resume date. */
  resumeOn?: string;
}

/** `GET /api/me/mentorship`. `status` and `maxActive` are null without a mentorship row (students). */
export interface MyMentorship {
  status: MentorStatus | null;
  maxActive: number | null;
  /** Active mentorship relationships as the mentor. */
  activeCount: number;
  /** Pending requests waiting for the caller's answer. */
  pendingIncoming: number;
  /** Pending requests the caller sent. */
  pendingOutgoing: number;
  /** How many pending requests a member may have at once (config `pending_cap`). */
  pendingCap: number;
}

/** `GET /api/me/suggested-mentors?topic=`: up to three mentors taking requests. */
export interface SuggestedMentorsResponse {
  items: DirectoryEntry[];
}
