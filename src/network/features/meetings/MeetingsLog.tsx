/**
 * The meetings log (`/network/me/meetings`, Task 31): every meeting the
 * caller has, as mentor and as mentee, from `GET /api/meetings`. Upcoming
 * (soonest first) and Past (most recent first) live in the URL
 * (`?show=past`, `&page=`). Each row opens the relationship it belongs to;
 * a past meeting nobody has answered for asks "Did you meet?" in place.
 */

import { Link, useSearchParams } from "react-router";
import { fmtMeetingDay, isoToLouisiana } from "@shared/meeting-time";
import type { Meeting, MeetingLogScope } from "@shared/types/meetings";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Notice, PageHead, Status, Tabs } from "../../ui/ui";
import "../../ui/meetings.css";
import { MEETINGS_PAGE_SIZE, useMeetingLog } from "./api";
import { MODE_LABEL, OutcomeQuestion, meetingOutcomeLabel, meetingSpan } from "./Scheduling";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function meetingPath(m: Meeting): string {
  return m.role === "mentor" ? `/mentor/mentees/${m.requestId}` : `/me/requests/${m.requestId}`;
}

function counterparty(m: Meeting): string {
  if (m.counterparty.former) return "Former member";
  return [m.counterparty.firstName, m.counterparty.lastName].filter(Boolean).join(" ") || "Member";
}

/** The other party's first name, mid-sentence. */
function firstOf(m: Meeting): string {
  return m.counterparty.former ? "this member" : m.counterparty.firstName?.trim() || "this member";
}

function subject(m: Meeting): string {
  if (m.kind === "introduction") return "Introduction";
  return m.topicLabel ?? "Mentorship";
}

/** The state on the right of a row, in the request vocabulary's tones. */
function MeetingState({ m }: { m: Meeting }) {
  if (m.awaitingOutcome) return <Status tone="pending" label="Not answered" />;
  if (m.status === "upcoming") return <Status tone="upcoming" />;
  if (m.met === true) return <Status tone="completed" label="Met" />;
  return <Status tone="canceled" label={meetingOutcomeLabel(m, firstOf(m))} />;
}

function MeetingRow({ m }: { m: Meeting }) {
  const { date } = isoToLouisiana(m.startsAt);
  const [, month, day] = date.split("-").map(Number);
  const times = meetingSpan(m).split(" · ")[1];
  return (
    <li className="pn-meeting-row border-b border-[var(--pn-line)] last:border-0">
      <Link to={meetingPath(m)} className="pn-meeting-row-link">
        <span className="pn-meeting-date" aria-hidden="true">
          <strong>{day}</strong>
          <span>{MONTHS[month - 1]}</span>
        </span>
        <span className="min-w-0">
          <span className="pn-row-title block truncate">{counterparty(m)}</span>
          <span className="pn-row-meta block">
            <span className="sr-only">{fmtMeetingDay(m.startsAt, true)}, </span>
            {times} · {MODE_LABEL[m.mode]} · {m.role === "mentor" ? "As mentor" : "As mentee"} · {subject(m)}
          </span>
        </span>
      </Link>
      <MeetingState m={m} />
      {m.awaitingOutcome ? (
        <div className="pn-meeting-row-ask">
          <OutcomeQuestion meeting={m} first={firstOf(m)} heading={false} />
        </div>
      ) : null}
    </li>
  );
}

export function MeetingsLog() {
  useMeta({ title: "Meetings" });
  const [params, setParams] = useSearchParams();
  const show: MeetingLogScope = params.get("show") === "past" ? "past" : "upcoming";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const upcoming = useMeetingLog("upcoming", show === "upcoming" ? page : 1);
  const past = useMeetingLog("past", show === "past" ? page : 1);
  const current = show === "upcoming" ? upcoming : past;

  const choose = (next: MeetingLogScope) => {
    const search = new URLSearchParams(params);
    if (next === "past") search.set("show", "past");
    else search.delete("show");
    search.delete("page");
    setParams(search);
  };
  const goTo = (next: number) => {
    const search = new URLSearchParams(params);
    if (next > 1) search.set("page", String(next));
    else search.delete("page");
    setParams(search);
  };

  const data = current.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / MEETINGS_PAGE_SIZE)) : 1;

  return (
    <>
      <PageHead
        kicker="Meetings"
        title="Every meeting you have arranged."
        lead="As a mentor and as a mentee, in one list. Times are in Louisiana time (Central). Open a meeting to change it or to propose new times."
      />
      <div className="mt-8">
        <Tabs
          label="Which meetings"
          value={show}
          onChange={choose}
          tabs={[
            { id: "upcoming", label: "Upcoming", count: upcoming.data?.total },
            { id: "past", label: "Past", count: past.data?.total },
          ]}
        />
      </div>
      <Card flush className="mt-6">
        {current.isError ? (
          <div className="p-5">
            <Notice tone="warn">
              {isApiError(current.error, "network")
                ? "Your meetings did not load. Check your connection and try again."
                : "Your meetings did not load. Try again in a moment."}
            </Notice>
          </div>
        ) : !data ? (
          <p className="t-small text-fg-2 p-5" role="status">
            Loading your meetings
          </p>
        ) : data.items.length > 0 ? (
          <ul aria-label="Meetings">
            {data.items.map((m) => (
              <MeetingRow key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <Empty inline title={show === "past" ? "No past meetings yet." : "Nothing coming up."}>
              {show === "past"
                ? "Meetings that have happened or were canceled appear here."
                : "When you and a mentor or mentee agree a time, it appears here. Propose times from an accepted request or a mentorship."}
            </Empty>
          </div>
        )}
      </Card>
      {data && pages > 1 ? (
        <nav className="flex items-center justify-between gap-4 mt-4 t-small" aria-label="Meeting pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Previous
          </button>
          <span className="text-fg-2">
            Page {Math.min(page, pages)} of {pages}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}
