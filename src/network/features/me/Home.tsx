/**
 * The member home (`/network/me`, 03 section 2): where this account stands,
 * what changed lately, and the next useful step. The profile banner reads
 * `GET /api/me/profile` (falling back to the session while it loads): a
 * professional waiting for review is told so, a declined one sees the
 * reviewer's notes, a listed one sees who can find them. Onboarding sends
 * professionals here with `?submitted=1`.
 *
 * Request counts from `GET /api/me/mentorship` fill `MentorshipCard`: the
 * mentee's half is Task 22's, the mentor's half (requests waiting, oldest
 * first, and the capacity line) Task 23's.
 */

import { ArrowRight, ArrowUpRight, CircleCheck, Clock, EyeOff, PencilLine } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { SessionUser } from "@shared/types/auth";
import type { ApprovalState } from "@shared/types/common";
import type { OwnProfile } from "@shared/types/me";
import { isMentor } from "../../app/nav";
import { api } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Card, Empty, Notice, PageHead } from "../../ui/ui";
import { NotificationRows, notificationErrorText } from "../notifications/List";
import { useNotifications } from "../notifications/api";
import { daysLeftLabel } from "../mentor/RequestDrawer";
import { CapacityLine } from "../mentor/Requests";
import { counterpartyName, requestSubject } from "./Requests";
import { useMyMentorship, useRequestList } from "./requests-api";

/** How many notifications Home shows before "See all". */
const LATEST = 5;

export const ownProfileKey = ["me", "profile"] as const;

export function useOwnProfile() {
  const { user } = useSession();
  return useQuery({
    queryKey: ownProfileKey,
    queryFn: () => api<OwnProfile>("/me/profile"),
    enabled: user !== null,
  });
}

function visibilityLine(visibility: "public" | "members"): string {
  return visibility === "members"
    ? "Signed-in members can find it in the directory."
    : "Anyone can find it in the directory.";
}

/** The profile status banner. Students have nothing to wait for, so they get none. */
export function ProfileStatusBanner({
  user,
  profile,
  submitted,
}: {
  user: SessionUser;
  profile: OwnProfile | undefined;
  submitted: boolean;
}) {
  if (user.kind !== "professional") return null;
  const state: ApprovalState = profile?.approvalState ?? user.approvalState;
  const ownProfile = (
    <Link to={`/directory/${user.id}`} className="link t-small">
      See your profile
      <ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  );

  if (state === "pending") {
    return (
      <Notice tone="info" icon={<Clock size={18} aria-hidden="true" />}>
        <p>
          <strong>{submitted ? "Thanks, your profile is submitted. " : ""}Waiting for review.</strong> An administrator
          reviews every new professional profile before it is listed, usually within a few days. Until then only you can
          see it. You will get a notification when it is decided.
        </p>
        <p className="mt-2">{ownProfile}</p>
      </Notice>
    );
  }

  if (state === "declined") {
    const notes = profile?.review?.decision === "declined" ? profile.review.notes : null;
    return (
      <Notice tone="warn" icon={<PencilLine size={18} aria-hidden="true" />}>
        <p>
          <strong>Your profile needs changes before it is listed.</strong> It is not in the directory yet.
        </p>
        {notes ? (
          <div className="mt-3">
            <p className="t-small">Notes from the reviewer</p>
            <p className="mt-1 text-fg whitespace-pre-line" data-testid="review-notes">
              {notes}
            </p>
          </div>
        ) : null}
        <p className="mt-3">
          <Link to="/onboarding" className="link t-small">
            Update and resubmit
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      </Notice>
    );
  }

  if (profile?.adminHidden) {
    return (
      <Notice tone="warn" icon={<EyeOff size={18} aria-hidden="true" />}>
        <p>
          <strong>An administrator has hidden your profile.</strong> It is not in the directory, and mentorship requests
          are off while it is hidden. Only an administrator can restore it.
        </p>
      </Notice>
    );
  }

  // Until the own profile loads, claim nothing about who can find it.
  if (!profile) {
    return (
      <Notice tone="info" icon={<CircleCheck size={18} aria-hidden="true" />}>
        <p>
          <strong>Your profile is approved.</strong>
        </p>
        <p className="mt-2">{ownProfile}</p>
      </Notice>
    );
  }

  if (profile.visibility === "hidden") {
    return (
      <Notice tone="info" icon={<EyeOff size={18} aria-hidden="true" />}>
        <p>
          <strong>Your profile is approved but hidden.</strong> Nobody finds it in the directory until you choose who
          can see it.
        </p>
        <p className="mt-2">
          <Link to="/settings/privacy" className="link t-small">
            Choose who can see it
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      </Notice>
    );
  }

  return (
    <Notice tone="ok" icon={<CircleCheck size={18} aria-hidden="true" />}>
      <p>
        <strong>Your profile is listed.</strong> {visibilityLine(profile.visibility)}
      </p>
      <p className="mt-2">{ownProfile}</p>
    </Notice>
  );
}

interface Step {
  text: string;
  to: string;
  label: string;
}

function nextStep(user: SessionUser, state: ApprovalState): Step {
  if (user.kind === "student") {
    return {
      text: "Find someone whose work you want to learn about, and save the profiles you want to come back to.",
      to: "/me/discover",
      label: "Find mentors",
    };
  }
  if (state === "pending") {
    return { text: "While you wait, see who is already in the directory.", to: "/directory", label: "Browse the directory" };
  }
  if (state === "declined") {
    return { text: "Update your profile with the reviewer's notes.", to: "/settings", label: "Edit your profile" };
  }
  if (isMentor(user)) {
    return {
      text: "Keep your topics and availability current, so students know what to ask you about and when.",
      to: "/settings/mentorship",
      label: "Mentorship settings",
    };
  }
  return {
    text: "Students and early-career members are looking for people who have done the work. Offering mentorship is one setting away.",
    to: "/settings/mentorship",
    label: "Offer mentorship",
  };
}

/** Mentorship at a glance: a mentor's waiting requests, or the requests a member sent. */
function MentorshipCard({ user }: { user: SessionUser }) {
  return isMentor(user) ? <MentorMentorshipCard /> : <MenteeMentorshipCard />;
}

/**
 * Requests waiting for a mentor (03 section 3.3, Task 23): the oldest
 * first with the days left to answer, and the capacity line, from
 * `GET /api/me/mentorship` and the mentor's pending inbox.
 */
function MentorMentorshipCard() {
  const mine = useMyMentorship();
  const waiting = useRequestList("mentor", ["pending"], 1, 3);
  const m = mine.data;
  const count = m?.pendingIncoming;
  return (
    <section aria-label="Requests waiting for you">
      <Card title="Requests waiting for you">
        <p className="t-body">
          {count === undefined
            ? "Requests people send you appear here with the days left to answer."
            : count === 0
              ? m?.status === "paused"
                ? "Nothing waiting. Mentorship is paused, so nobody can send you a request until you resume."
                : "Nothing waiting. You get an email when someone asks for your time."
              : `${count} ${count === 1 ? "request is" : "requests are"} waiting for your answer.`}
        </p>
        {waiting.data && waiting.data.items.length > 0 ? (
          <ul className="pn-ledger mt-4" aria-label="Oldest waiting requests">
            {waiting.data.items.map((r) => (
              <li key={r.id}>
                <Link to={`/mentor/requests/${r.id}`} className="pn-row-link">
                  <span className="min-w-0">
                    <span className="pn-row-title block truncate">{counterpartyName(r.counterparty)}</span>
                    <span className="pn-row-meta block truncate">{requestSubject(r)}</span>
                  </span>
                  <span className="pn-status" data-tone="pending">
                    {daysLeftLabel(r.expiresAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <CapacityLine className="mt-4" />
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
          <Link to="/mentor/requests" className="link t-small inline-flex">
            Mentoring inbox
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link to="/me/requests" className="link t-small inline-flex">
            My requests
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </section>
  );
}

/** The requests this member sent, at a glance (Task 22). */
function MenteeMentorshipCard() {
  const mine = useMyMentorship();
  const waiting = mine.data?.pendingOutgoing;
  return (
    <Card title="Mentorship">
      <p className="t-body">
        {waiting === undefined
          ? "Ask a mentor about one of their topics, or ask a professional for an introduction."
          : waiting === 0
            ? "No requests waiting. When a mentor's topics fit what you are working on, ask from their profile."
            : `You have ${waiting} ${waiting === 1 ? "request" : "requests"} waiting for an answer.`}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
        <Link to="/me/discover" className="link t-small inline-flex">
          Find mentors
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link to="/me/requests" className="link t-small inline-flex">
          My requests
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

function LatestNotifications() {
  const latest = useNotifications(false, 1, LATEST);
  const data = latest.data;
  return (
    <Card
      title="Latest notifications"
      aside={
        <Link to="/notifications" className="link link-quiet t-small">
          See all{data && data.unread > 0 ? ` (${data.unread} unread)` : ""}
        </Link>
      }
    >
      {latest.isError ? (
        <Notice tone="warn">{notificationErrorText(latest.error)}</Notice>
      ) : data ? (
        data.items.length > 0 ? (
          <NotificationRows items={data.items} />
        ) : (
          <Empty inline title="Nothing new." />
        )
      ) : (
        <p className="t-small text-fg-2">Loading notifications</p>
      )}
    </Card>
  );
}

export function Home() {
  useMeta({ title: "Home" });
  const { user } = useSession();
  const profile = useOwnProfile();
  const [params] = useSearchParams();
  // The guards render this page only for a signed-in member.
  if (!user) return null;

  const firstName = profile.data?.firstName?.trim();
  const state: ApprovalState = profile.data?.approvalState ?? user.approvalState;
  const step = nextStep(user, state);

  return (
    <>
      <PageHead
        kicker={firstName ? `Good to see you, ${firstName}` : "Home"}
        title="Your network, at a glance."
        actions={
          <Link to="/directory" className="btn btn-outline btn-sm">
            Browse the directory
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        }
      />

      {user.kind === "professional" ? (
        <section aria-label="Profile status" className="mt-8 max-w-3xl">
          <ProfileStatusBanner user={user} profile={profile.data} submitted={params.get("submitted") === "1"} />
        </section>
      ) : null}

      <div className="pn-split mt-8">
        <LatestNotifications />
        <div className="grid gap-6">
          <Card accent title="Next step">
            <p className="t-lead">{step.text}</p>
            <Link to={step.to} className="btn btn-solid btn-sm mt-5">
              {step.label}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Card>
          <MentorshipCard user={user} />
        </div>
      </div>
    </>
  );
}
