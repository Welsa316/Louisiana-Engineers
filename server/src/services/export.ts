import type { DeclineReason, MeetingMode, NotificationCategory, RequestFormat, RequestKind, RequestStatus } from "@shared/types/common";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type DataExport,
  type ExportAuditEntry,
  type ExportNotification,
  type ExportRelationship,
  type ExportRequest,
} from "@shared/types/export";
import type { RequestRole } from "@shared/types/requests";
import type { Db } from "../db/tx";
import { exportFeedback } from "./feedback";
import { exportMeetings } from "./meetings";
import { photoForExport } from "./photos";
import { getOwnProfile } from "./profiles";

/**
 * The personal data export (Task 27, ACC-7). Runs in the member's own
 * `withUser` transaction, so every read goes through the same views,
 * policies and definer functions as the app: the own profile and settings
 * from the profiles service, requests and relationships from `my_requests`
 * (the other party's public fields only, of which only the name is kept),
 * meetings and proposed times from the meetings service (names only),
 * the caller's own feedback answers (never the other party's),
 * notifications under the recipient policy, and audit entries from
 * `my_audit_entries()`. A profile photo is noted (state, type and size),
 * never copied into the file. Contact values are never read: the handoff values
 * belong to the mentor, and the file carries only the method names.
 */

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** The name a counterparty is shown under; a deleted account reads "Former member". */
export function counterpartyName(first: string | null, last: string | null, former: boolean): string {
  if (former) return "Former member";
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(" ") || "Member";
}

interface RequestRow {
  id: string;
  role: RequestRole;
  kind: RequestKind;
  status: RequestStatus;
  topic_label: string | null;
  mentee_id: string;
  mentor_id: string;
  counterparty_first_name: string | null;
  counterparty_last_name: string | null;
  counterparty_former: boolean;
  why: string;
  goals: string | null;
  scheduling_note: string | null;
  mentor_note: string | null;
  decline_reason: DeclineReason | null;
  text_purged: boolean;
  format: RequestFormat;
  mode: MeetingMode;
  created_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  relationship_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  completed_by: string | null;
  shared_methods: ExportRelationship["sharedMethods"];
}

async function requestsAndRelationships(db: Db): Promise<{ requests: ExportRequest[]; relationships: ExportRelationship[] }> {
  const rows = await db.query<RequestRow>(
    `SELECT r.id, r.role, r.kind::text AS kind, r.status::text AS status, r.topic_label,
            r.mentee_id, r.mentor_id, r.counterparty_first_name, r.counterparty_last_name, r.counterparty_former,
            r.why, r.goals, r.scheduling_note, r.mentor_note, r.decline_reason::text AS decline_reason, r.text_purged,
            r.format::text AS format, r.mode::text AS mode, r.created_at, r.expires_at, r.responded_at,
            r.relationship_id, r.started_at, r.completed_at, r.completed_by, r.shared_methods
       FROM my_requests r
      ORDER BY r.created_at, r.id`,
  );

  const requests: ExportRequest[] = [];
  const relationships: ExportRelationship[] = [];
  for (const row of rows) {
    const counterparty = counterpartyName(row.counterparty_first_name, row.counterparty_last_name, row.counterparty_former);
    requests.push({
      id: row.id,
      role: row.role,
      kind: row.kind,
      status: row.status,
      topic: row.topic_label,
      counterparty,
      why: row.why,
      goals: row.goals,
      schedulingNote: row.scheduling_note,
      mentorNote: row.mentor_note,
      declineReason: row.decline_reason,
      textPurged: row.text_purged,
      format: row.format,
      mode: row.mode,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      respondedAt: iso(row.responded_at),
    });
    if (row.relationship_id && row.started_at) {
      const callerId = row.role === "mentee" ? row.mentee_id : row.mentor_id;
      relationships.push({
        requestId: row.id,
        role: row.role,
        counterparty,
        topic: row.topic_label,
        startedAt: row.started_at.toISOString(),
        completedAt: iso(row.completed_at),
        completedBy: row.completed_by === null ? null : row.completed_by === callerId ? "me" : "them",
        sharedMethods: row.shared_methods,
      });
    }
  }
  return { requests, relationships };
}

async function notifications(db: Db): Promise<ExportNotification[]> {
  const rows = await db.query<{
    category: NotificationCategory;
    title: string;
    body: string;
    link: string | null;
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT category::text AS category, title, body, link, created_at, read_at
       FROM notifications WHERE recipient_id = app_uid()
      ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.created_at.toISOString(),
    readAt: iso(row.read_at),
  }));
}

async function auditEntries(db: Db): Promise<ExportAuditEntry[]> {
  const rows = await db.query<{
    action: string;
    subject_type: string | null;
    actor: ExportAuditEntry["actor"];
    detail: Record<string, unknown>;
    created_at: Date;
  }>("SELECT action, subject_type, actor, detail, created_at FROM my_audit_entries()");
  return rows.map((row) => ({
    action: row.action,
    subjectType: row.subject_type,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  }));
}

/** `GET /api/me/export`: the caller's data, assembled in one transaction. */
export async function exportMyData(db: Db): Promise<DataExport> {
  const hasProfile = await db.maybeOne<{ id: string }>("SELECT id FROM profiles WHERE id = app_uid()");
  let profile: DataExport["profile"] = null;
  let settings: DataExport["settings"] = null;
  if (hasProfile) {
    const { settings: own, ...rest } = await getOwnProfile(db);
    profile = rest;
    settings = own;
  }
  const { requests, relationships } = await requestsAndRelationships(db);
  const { meetings, availabilitySlots } = await exportMeetings(db);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    settings,
    photo: await photoForExport(db),
    requests,
    relationships,
    meetings,
    availabilitySlots,
    feedback: await exportFeedback(db),
    notifications: await notifications(db),
    audit: await auditEntries(db),
  };
}
