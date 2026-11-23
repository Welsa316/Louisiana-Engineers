import type { AudienceId, ContactMethodId, ParticipationId } from "@shared/taxonomy";

/** A mentorship topic id from @shared/taxonomy (labels come from `topicLabel`). */
export type TopicId = string;

/** Who can see a professional's directory entry. */
export type Visibility = "public" | "members" | "hidden";

export type MentorStatus = "active" | "paused";

export type ApprovalState = "approved" | "pending" | "declined";

export interface Education {
  degree: string;
  field: string;
  school: string;
  year: number;
}

export interface MentorshipSettings {
  status: MentorStatus;
  topics: TopicId[];
  audience: AudienceId[];
  /** One-time guidance, recurring mentoring, or either. */
  format: "one-time" | "recurring" | "either";
  mode: "online" | "in-person" | "either";
  /** Free-text general availability, e.g. "Weekday evenings". */
  availability: string;
  duration: 30 | 45 | 60;
  maxActive: number;
  /** If set, the mentor is paused until this date (ISO). */
  pausedUntil?: string;
}

export interface Professional {
  id: string;
  firstName: string;
  lastName: string;
  /** Post-nominal letters: PE, PhD, MD. */
  credentials?: string;
  title: string;
  organization: string;
  disciplineId: string;
  location: string;
  yearsExperience: number;
  bio: string;
  expertise: string[];
  interests: string[];
  education: Education[];
  visibility: Visibility;
  participation: ParticipationId[];
  contactMethods: ContactMethodId[];
  hasLinkedIn: boolean;
  hasBookingLink: boolean;
  mentorship?: MentorshipSettings;
  approval: ApprovalState;
  /** Affiliation verified by an administrator. */
  verified: boolean;
  joinedAt: string;
  lastActiveAt: string;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  program: string;
  level: AudienceId;
  institution: string;
  location: string;
  goals: string;
  interests: string[];
  topicsNeeded: TopicId[];
  joinedAt: string;
}

export type RequestStatus = "pending" | "accepted" | "declined" | "completed" | "canceled" | "expired";

export interface MentorshipRequest {
  id: string;
  menteeId: string;
  mentorId: string;
  topic: TopicId;
  why: string;
  goals: string;
  format: "one-time" | "recurring";
  mode: "online" | "in-person" | "either";
  schedulingNote: string;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt?: string;
  /** Mentor's note to the mentee on accept or decline. */
  mentorNote?: string;
  declineReason?: string;
}

export interface Meeting {
  id: string;
  requestId: string;
  startsAt: string;
  durationMin: number;
  mode: "online" | "in-person";
  place: string;
  agenda: string;
  status: "upcoming" | "completed";
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: "request" | "accept" | "decline" | "meeting" | "join" | "approve" | "profile" | "report";
  text: string;
}

export interface Report {
  id: string;
  profileId: string;
  reason: string;
  detail: string;
  reportedAt: string;
  status: "open" | "resolved" | "dismissed";
}

export type Role = "visitor" | "mentee" | "mentor" | "admin";
