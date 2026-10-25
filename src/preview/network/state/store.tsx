/**
 * Prototype state: React context + reducer, mirrored to sessionStorage so a
 * reload keeps the walkthrough going. Nothing leaves the browser. The real
 * build replaces this with TanStack Query over Supabase; the action names
 * here are the API surface the real build should offer.
 */

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import {
  activity as seedActivity,
  CURRENT_MENTEE_ID,
  CURRENT_MENTOR_ID,
  daysFromToday,
  meetings as seedMeetings,
  professionals as seedProfessionals,
  reports as seedReports,
  requests as seedRequests,
  students as seedStudents,
  fullName,
} from "../data/mock";
import type {
  ActivityItem,
  Meeting,
  MentorshipRequest,
  MentorshipSettings,
  Professional,
  Report,
  Role,
  Student,
} from "../data/types";

export interface NotificationPrefs {
  newRequestEmail: boolean;
  reminderEmail: boolean;
  weeklyDigest: boolean;
  meetingReminders: boolean;
}

export interface State {
  role: Role;
  professionals: Professional[];
  students: Student[];
  requests: MentorshipRequest[];
  meetings: Meeting[];
  activity: ActivityItem[];
  reports: Report[];
  /** Professionals saved by the current mentee. */
  saved: string[];
  notificationPrefs: NotificationPrefs;
  /** Transient toast message. */
  toast: { id: number; text: string } | null;
}

export type Action =
  | { type: "setRole"; role: Role }
  | { type: "toggleSaved"; id: string }
  | { type: "sendRequest"; id?: string; request: Omit<MentorshipRequest, "id" | "status" | "createdAt" | "expiresAt"> }
  | { type: "cancelRequest"; id: string }
  | { type: "respond"; id: string; decision: "accepted" | "declined"; note: string; reason?: string }
  | { type: "completeRequest"; id: string }
  | { type: "scheduleMeeting"; meeting: Omit<Meeting, "id" | "status"> }
  | { type: "updateMentorship"; id: string; settings: Partial<MentorshipSettings> }
  | { type: "updateProfessional"; id: string; patch: Partial<Professional> }
  | { type: "reviewProfile"; id: string; decision: "approved" | "declined" }
  | { type: "setVerified"; id: string; verified: boolean }
  | { type: "resolveReport"; id: string; outcome: "resolved" | "dismissed" }
  | { type: "setNotificationPrefs"; prefs: Partial<NotificationPrefs> }
  | { type: "toast"; text: string }
  | { type: "clearToast" }
  | { type: "reset" };

const STORAGE_KEY = "mest-network-prototype-v1";

function initialState(): State {
  return {
    role: "visitor",
    professionals: seedProfessionals,
    students: seedStudents,
    requests: seedRequests,
    meetings: seedMeetings,
    activity: seedActivity,
    reports: seedReports,
    saved: ["layla-haddad", "khalid-boudreaux"],
    notificationPrefs: { newRequestEmail: true, reminderEmail: true, weeklyDigest: false, meetingReminders: true },
    toast: null,
  };
}

let counter = 2000;
/** Prototype ids. The real build uses database-generated UUIDs. */
export const newId = (prefix: string) => `${prefix}-${++counter}-${Date.now().toString(36).slice(-4)}`;
const nextId = newId;
const now = () => new Date().toISOString();

function log(state: State, kind: ActivityItem["kind"], text: string): ActivityItem[] {
  return [{ id: nextId("act"), at: now(), kind, text }, ...state.activity];
}

function personName(state: State, id: string) {
  const p = state.professionals.find((x) => x.id === id);
  if (p) return fullName(p);
  const s = state.students.find((x) => x.id === id);
  return s ? fullName(s) : "A member";
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setRole":
      return { ...state, role: action.role };

    case "toggleSaved":
      return {
        ...state,
        saved: state.saved.includes(action.id)
          ? state.saved.filter((s) => s !== action.id)
          : [...state.saved, action.id],
      };

    case "sendRequest": {
      const created = now();
      const expires = new Date(created);
      expires.setDate(expires.getDate() + 14);
      const request: MentorshipRequest = {
        ...action.request,
        id: action.id ?? newId("req"),
        status: "pending",
        createdAt: created,
        expiresAt: expires.toISOString(),
      };
      return {
        ...state,
        requests: [request, ...state.requests],
        activity: log(
          state,
          "request",
          `${personName(state, request.menteeId)} sent a mentorship request to ${personName(state, request.mentorId)}.`,
        ),
        toast: { id: Date.now(), text: "Request sent. The mentor has 14 days to respond." },
      };
    }

    case "cancelRequest":
      return {
        ...state,
        requests: state.requests.map((r) =>
          r.id === action.id ? { ...r, status: "canceled", respondedAt: now() } : r,
        ),
        toast: { id: Date.now(), text: "Request withdrawn." },
      };

    case "respond": {
      const req = state.requests.find((r) => r.id === action.id);
      if (!req) return state;
      const accepted = action.decision === "accepted";
      return {
        ...state,
        requests: state.requests.map((r) =>
          r.id === action.id
            ? {
                ...r,
                status: action.decision,
                respondedAt: now(),
                mentorNote: action.note,
                declineReason: accepted ? undefined : action.reason,
              }
            : r,
        ),
        activity: log(
          state,
          accepted ? "accept" : "decline",
          `${personName(state, req.mentorId)} ${accepted ? "accepted" : "declined"} ${personName(state, req.menteeId)}'s request.`,
        ),
        toast: {
          id: Date.now(),
          text: accepted
            ? "Accepted. The mentee can now see your contact details and note."
            : "Declined. The mentee has been notified with your note.",
        },
      };
    }

    case "completeRequest":
      return {
        ...state,
        requests: state.requests.map((r) => (r.id === action.id ? { ...r, status: "completed" } : r)),
        toast: { id: Date.now(), text: "Marked complete. Thank you for your time." },
      };

    case "scheduleMeeting": {
      const meeting: Meeting = { ...action.meeting, id: nextId("mtg"), status: "upcoming" };
      const req = state.requests.find((r) => r.id === meeting.requestId);
      return {
        ...state,
        meetings: [...state.meetings, meeting],
        activity: req
          ? log(state, "meeting", `${personName(state, req.mentorId)} scheduled a meeting with ${personName(state, req.menteeId)}.`)
          : state.activity,
        toast: { id: Date.now(), text: "Meeting added. Both of you will get a reminder." },
      };
    }

    case "updateMentorship":
      return {
        ...state,
        professionals: state.professionals.map((p) =>
          p.id === action.id && p.mentorship ? { ...p, mentorship: { ...p.mentorship, ...action.settings } } : p,
        ),
        toast: { id: Date.now(), text: "Mentorship preferences saved." },
      };

    case "updateProfessional":
      return {
        ...state,
        professionals: state.professionals.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
        toast: { id: Date.now(), text: "Profile saved." },
      };

    case "reviewProfile": {
      const p = state.professionals.find((x) => x.id === action.id);
      if (!p) return state;
      return {
        ...state,
        professionals: state.professionals.map((x) => (x.id === action.id ? { ...x, approval: action.decision } : x)),
        activity: log(
          state,
          "approve",
          action.decision === "approved"
            ? `${fullName(p)}'s profile was approved and listed.`
            : `${fullName(p)}'s profile was declined and the member notified.`,
        ),
        toast: {
          id: Date.now(),
          text: action.decision === "approved" ? `${p.firstName} is now listed in the directory.` : `${p.firstName} has been notified.`,
        },
      };
    }

    case "setVerified":
      return {
        ...state,
        professionals: state.professionals.map((p) => (p.id === action.id ? { ...p, verified: action.verified } : p)),
      };

    case "resolveReport":
      return {
        ...state,
        reports: state.reports.map((r) => (r.id === action.id ? { ...r, status: action.outcome } : r)),
        toast: { id: Date.now(), text: action.outcome === "resolved" ? "Report resolved." : "Report dismissed." },
      };

    case "setNotificationPrefs":
      return { ...state, notificationPrefs: { ...state.notificationPrefs, ...action.prefs } };

    case "toast":
      return { ...state, toast: { id: Date.now(), text: action.text } };

    case "clearToast":
      return { ...state, toast: null };

    case "reset":
      return { ...initialState(), role: state.role };

    default:
      return state;
  }
}

function load(): State {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<State>;
    return { ...initialState(), ...parsed, toast: null };
  } catch {
    return initialState();
  }
}

interface StoreValue {
  state: State;
  dispatch: (action: Action) => void;
  /** Convenience selectors used across screens. */
  me: {
    mentee: Student;
    mentor: Professional;
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      const { toast: _toast, ...rest } = state;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* private mode or quota: the prototype still works in memory */
    }
  }, [state]);

  useEffect(() => {
    if (!state.toast) return;
    const t = window.setTimeout(() => dispatch({ type: "clearToast" }), 4200);
    return () => window.clearTimeout(t);
  }, [state.toast]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      dispatch,
      me: {
        mentee: state.students.find((s) => s.id === CURRENT_MENTEE_ID)!,
        mentor: state.professionals.find((p) => p.id === CURRENT_MENTOR_ID)!,
      },
    }),
    [state],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

/* ---------- Derived helpers ---------- */

export function isListed(p: Professional, role: Role): boolean {
  if (p.approval !== "approved") return false;
  if (!p.participation.includes("directory")) return false;
  if (p.visibility === "hidden") return false;
  if (p.visibility === "members") return role !== "visitor";
  return true;
}

export function isMentorAvailable(p: Professional, requests: MentorshipRequest[]): boolean {
  if (!p.mentorship || p.mentorship.status !== "active") return false;
  return activeMenteeCount(p.id, requests) < p.mentorship.maxActive;
}

export function activeMenteeCount(mentorId: string, requests: MentorshipRequest[]): number {
  return requests.filter((r) => r.mentorId === mentorId && r.status === "accepted").length;
}

export function openRequestCount(menteeId: string, requests: MentorshipRequest[]): number {
  return requests.filter((r) => r.menteeId === menteeId && r.status === "pending").length;
}

export const MAX_OPEN_REQUESTS = 3;

export function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - new Date(daysFromToday(0)).getTime();
  return Math.ceil(ms / 86_400_000);
}
