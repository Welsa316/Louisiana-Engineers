/**
 * `GET /api/me/export` (Task 27, ACC-7): everything the platform holds about
 * the signed-in member, as one JSON file. The other party of a request or
 * relationship appears only as a display name ("Former member" once their
 * account is deleted): no id, title, organization, contact value or student
 * details. The sign-in address stays in `users` and is not part of the file.
 */

import type { ContactMethodId } from "../taxonomy";
import type { DeclineReason, MeetingMode, NotificationCategory, RequestFormat, RequestKind, RequestStatus } from "./common";
import type { ExportFeedback } from "./feedback";
import type { ExportMeeting, ExportSlot } from "./meetings";
import type { OwnProfile, OwnSettings } from "./me";
import type { PhotoContentType, PhotoStatus } from "./photos";
import type { RequestRole } from "./requests";

export const EXPORT_FORMAT = "mest-network-export";
export const EXPORT_VERSION = 1;

/** A request in either direction: `mentee` means the caller sent it, `mentor` that they received it. */
export interface ExportRequest {
  id: string;
  role: RequestRole;
  kind: RequestKind;
  status: RequestStatus;
  /** The topic's label; null for an introduction. */
  topic: string | null;
  /** The other party's display name. */
  counterparty: string;
  why: string;
  goals: string | null;
  schedulingNote: string | null;
  mentorNote: string | null;
  declineReason: DeclineReason | null;
  /** The text was emptied by the retention rule or a deletion. */
  textPurged: boolean;
  format: RequestFormat;
  mode: MeetingMode;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface ExportRelationship {
  /** The request it came from, as listed in `requests`. */
  requestId: string;
  role: RequestRole;
  counterparty: string;
  topic: string | null;
  startedAt: string;
  completedAt: string | null;
  /** Who marked it completed, from the caller's point of view. */
  completedBy: "me" | "them" | null;
  /** The method names the mentor handed over; the values are not exported. */
  sharedMethods: Exclude<ContactMethodId, "mest">[];
}

export interface ExportNotification {
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

/** An audit entry whose subject is the caller. Who acted is never named when it was someone else. */
export interface ExportAuditEntry {
  action: string;
  subjectType: string | null;
  actor: "you" | "system" | "other";
  detail: Record<string, unknown>;
  createdAt: string;
}

/** That a profile photo exists and where it stands. The image itself is not in the file. */
export interface ExportPhoto {
  status: PhotoStatus;
  contentType: PhotoContentType;
  byteSize: number;
  uploadedAt: string;
  reviewedAt: string | null;
}

export interface DataExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** null only when the account has no profile row. */
  profile: Omit<OwnProfile, "settings"> | null;
  settings: OwnSettings | null;
  /** null when there is no photo. */
  photo: ExportPhoto | null;
  requests: ExportRequest[];
  relationships: ExportRelationship[];
  /** Meetings in either role (Task 30). */
  meetings: ExportMeeting[];
  /** Times proposed by either party of the caller's relationships (Task 30). */
  availabilitySlots: ExportSlot[];
  /** The caller's own post-completion feedback (Task 32); never the other party's. */
  feedback: ExportFeedback[];
  notifications: ExportNotification[];
  audit: ExportAuditEntry[];
}
