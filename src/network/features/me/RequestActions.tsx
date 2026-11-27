/**
 * The request buttons on a profile, for a signed-in member (03 section 6.2).
 * Task 15's `ProfileActions` renders this in its `slot`, after it has dealt
 * with the owner, visitors and accounts that have not finished joining, and
 * keeps the Save button beside it.
 *
 * `GET /api/mentors/:id/availability` decides the offer (the profile's own
 * mentorship fields stand in until it answers); the caller's open requests
 * decide whether there is already one with this person, since a pair can
 * hold only one open request:
 *
 *   already open          "Request pending since [date]" or "You are working with [name]"
 *   taking                Request mentorship
 *   paused                Mentorship paused (until [date])
 *   full                  Not taking new requests right now
 *   open to networking    Request an introduction, when not taking mentorship requests
 *   neither               nothing (the Mentorship panel already says so)
 */

import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { ProfileView } from "@shared/types/directory";
import type { AvailabilityState } from "@shared/types/requests";
import { fmtDate } from "../../ui/ui";
import type { ProfileSlot } from "../public/ProfileActions";
import { useAvailability, useOpenMenteeRequests } from "./requests-api";

/** "2027-01-15" as "January 15", read as a calendar day (no time zone shift). */
export function calendarDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/** The availability the profile itself implies, used until the endpoint answers. */
function impliedState(profile: ProfileView): AvailabilityState {
  const m = profile.mentorship;
  const networking = profile.participation.includes("networking");
  if (!m || m.status === "off") return networking ? "networking_only" : "off";
  if (m.status === "paused") return "paused";
  return m.hasCapacity ? "taking" : "full";
}

/** Where the request form lives for a mentor and a kind. */
export function requestFormPath(mentorId: string, kind: "mentorship" | "introduction" = "mentorship"): string {
  const search = new URLSearchParams({ mentor: mentorId });
  if (kind === "introduction") search.set("kind", "introduction");
  return `/me/requests/new?${search.toString()}`;
}

export function RequestActions({ profile }: { profile: ProfileView }) {
  const availability = useAvailability(profile.id);
  const open = useOpenMenteeRequests();
  const firstName = profile.firstName?.trim() || "this member";

  const existing = open.data?.items.find((r) => r.role === "mentee" && r.counterparty.id === profile.id);
  if (existing) {
    return existing.status === "accepted" ? (
      <Link to={`/me/requests/${existing.id}`} className="btn btn-outline">
        You are working with {firstName}. Open request
      </Link>
    ) : (
      <Link to={`/me/requests/${existing.id}`} className="btn btn-outline">
        Request pending since {fmtDate(existing.createdAt)}
      </Link>
    );
  }

  const state = availability.data?.state ?? impliedState(profile);
  const resumeOn = availability.data ? availability.data.resumeOn : (profile.mentorship?.pausedUntil ?? undefined);
  return <RequestButtons profile={profile} state={state} resumeOn={resumeOn} />;
}

/** The offer itself, for a member with no open request to this person. */
function RequestButtons({
  profile,
  state,
  resumeOn,
}: {
  profile: ProfileView;
  state: AvailabilityState;
  resumeOn: string | undefined;
}) {
  const networking = profile.participation.includes("networking");
  const notTaking = state === "paused" || state === "full";

  return (
    <>
      {state === "taking" && (
        <Link to={requestFormPath(profile.id)} className="btn btn-solid">
          Request mentorship
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
      {state === "paused" && (
        <button type="button" className="btn btn-outline" disabled>
          {resumeOn ? `Mentorship paused until ${calendarDay(resumeOn)}` : "Mentorship paused"}
        </button>
      )}
      {state === "full" && (
        <button type="button" className="btn btn-outline" disabled>
          Not taking new requests right now
        </button>
      )}
      {networking && state !== "taking" && (
        <Link to={requestFormPath(profile.id, "introduction")} className={notTaking ? "btn btn-ghost" : "btn btn-solid"}>
          Request an introduction
          {notTaking ? null : <ArrowUpRight size={16} aria-hidden="true" />}
        </Link>
      )}
    </>
  );
}

/** What the profile pages pass to `<Profile slot>`. */
export const requestSlot: ProfileSlot = (profile) => <RequestActions profile={profile} />;

/**
 * The owner's settings preview (`ProfileContent` with `preview`, which is
 * inert): the buttons a member with no open request would get, from the
 * profile alone, so nothing is asked of the API as the owner.
 */
export const previewRequestSlot: ProfileSlot = (profile) => (
  <RequestButtons profile={profile} state={impliedState(profile)} resumeOn={profile.mentorship?.pausedUntil ?? undefined} />
);
