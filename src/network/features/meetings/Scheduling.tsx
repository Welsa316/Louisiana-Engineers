/**
 * The Meetings card on a relationship (Task 31), the same for both parties:
 * on the mentor's relationship page (features/mentor/Relationship.tsx) and
 * on the mentee's accepted or completed request (features/me/RequestDetail.tsx).
 * Top to bottom, only what applies:
 *
 *   Did you meet [name]?   a meeting that has started and nobody answered
 *   Next meeting           upcoming meetings, each with Cancel meeting
 *   [Name] proposed times  the other party's open times: choose one, say
 *                          online or in person, where, and what to cover
 *   Waiting for [name]     the caller's own open times, and Change the times
 *   Propose times          when nothing of the caller's is open
 *   Earlier meetings       what happened to the rest
 *
 * A completed relationship keeps its history, its questions and its
 * cancellations, but takes no new times (the functions refuse them).
 */

import { useId, useMemo, useState, type FormEvent } from "react";
import { CalendarPlus } from "lucide-react";
import { fieldLimits } from "@shared/limits";
import { fmtDuration, fmtMeetingDay, fmtMeetingSpan } from "@shared/meeting-time";
import type { MeetingMode } from "@shared/types/common";
import type { Meeting, MeetingModeHeld, Slot } from "@shared/types/meetings";
import { Card, Field, Input, Modal, Notice, Option, Textarea } from "../../ui/ui";
import "../../ui/meetings.css";
import {
  meetingErrorText,
  useCancelMeeting,
  useChooseTime,
  useMeetingOutcome,
  useOpenSlots,
  useRelationshipMeetings,
} from "./api";
import { ProposeTimesDialog } from "./ProposeTimes";

export const MODE_LABEL: Record<MeetingModeHeld, string> = { online: "Online", "in-person": "In person" };

const byStart = (a: { startsAt: string }, b: { startsAt: string }) => a.startsAt.localeCompare(b.startsAt);

/** "Thu, Dec 3 · 10:30 to 11:15 AM" for a meeting. */
export const meetingSpan = (m: Pick<Meeting, "startsAt" | "endsAt">) => fmtMeetingSpan(m.startsAt, m.endsAt);

/** What became of a meeting that is neither coming up nor waiting for an answer. */
export function meetingOutcomeLabel(m: Meeting, first: string): string {
  if (m.met === true) return "You met";
  if (m.met === false) return "Did not happen";
  if (m.canceledAt) return m.canceledBy === "me" ? "Canceled by you" : `Canceled by ${first}`;
  if (m.status === "upcoming") return "Upcoming";
  return "Not answered";
}

/* ------------------------------------------------------------ the question */

/**
 * "Did you meet [name]?" with its two answers. A later answer from either
 * party replaces an earlier one, so this also serves "Change answer".
 */
export function OutcomeQuestion({
  meeting,
  first,
  heading = true,
  onAnswered,
}: {
  meeting: Meeting;
  first: string;
  /** A heading inside a card; the log names the group without one. */
  heading?: boolean;
  onAnswered?: () => void;
}) {
  const outcome = useMeetingOutcome();
  const titleId = useId();
  const question = `Did you meet ${first}?`;
  const answer = (met: boolean) => outcome.mutate({ id: meeting.id, met }, { onSuccess: () => onAnswered?.() });
  return (
    <div
      role="group"
      aria-labelledby={heading ? titleId : undefined}
      aria-label={heading ? undefined : question}
      className={heading ? "pn-meeting-block" : "pn-meeting-ask"}
    >
      {heading ? (
        <>
          <h3 id={titleId}>{question}</h3>
          <p className="pn-meeting-when t-body">{meetingSpan(meeting)}</p>
          <p className="pn-meeting-facts">
            <span>{fmtDuration(meeting.durationMin)}</span>
            <span>{MODE_LABEL[meeting.mode]}</span>
          </p>
          <p className="t-small text-fg-2 mt-3">Your answer is counted, as a number only, in the network&apos;s meeting totals.</p>
        </>
      ) : (
        <span className="t-small text-fg-2">{question}</span>
      )}
      <div className={heading ? "pn-meeting-actions" : "pn-meeting-ask-buttons"}>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={outcome.isPending}
          onClick={() => answer(true)}
        >
          Yes, we met
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={outcome.isPending} onClick={() => answer(false)}>
          No, it did not happen
        </button>
      </div>
      {outcome.isError ? (
        <p className="t-small mt-2" role="alert">
          {meetingErrorText(outcome.error)}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- next meeting */

function UpcomingMeeting({ meeting, first, title }: { meeting: Meeting; first: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelMeeting();
  const close = () => {
    setConfirming(false);
    cancel.reset();
  };
  return (
    <article className="pn-meeting-block">
      <h3>{title}</h3>
      <p className="pn-meeting-when t-body">{meetingSpan(meeting)}</p>
      <p className="pn-meeting-facts">
        <span>{fmtDuration(meeting.durationMin)}</span>
        <span>{MODE_LABEL[meeting.mode]}</span>
        <span>{meeting.createdBy === "me" ? "You confirmed it" : `${first} confirmed it`}</span>
      </p>
      {meeting.place ? (
        <p className="pn-meeting-note">
          <span className="text-fg-2">Where: </span>
          {meeting.place}
        </p>
      ) : null}
      {meeting.agenda ? (
        <p className="pn-meeting-note whitespace-pre-line">
          <span className="text-fg-2">To cover: </span>
          {meeting.agenda}
        </p>
      ) : null}
      <div className="pn-meeting-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
          Cancel meeting
        </button>
      </div>
      <Modal
        open={confirming}
        onClose={close}
        title="Cancel this meeting?"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(meeting.id, { onSuccess: close })}
            >
              Cancel meeting
            </button>
          </>
        }
      >
        <p>
          {first} is told that the meeting on {fmtMeetingDay(meeting.startsAt)} is off. Either of you can propose new
          times afterwards.
        </p>
        {cancel.isError ? (
          <p className="t-small mt-3" role="alert">
            {meetingErrorText(cancel.error)}
          </p>
        ) : null}
      </Modal>
    </article>
  );
}

/* -------------------------------------------------- their times: choose */

function ChooseTime({
  requestId,
  slots,
  first,
  preferredMode,
  onProposeOther,
}: {
  requestId: string;
  slots: Slot[];
  first: string;
  preferredMode: MeetingMode;
  onProposeOther: () => void;
}) {
  const choose = useChooseTime(requestId);
  const [slotId, setSlotId] = useState<string | null>(slots.length === 1 ? slots[0].id : null);
  const [mode, setMode] = useState<MeetingModeHeld>(preferredMode === "in-person" ? "in-person" : "online");
  const [place, setPlace] = useState("");
  const [agenda, setAgenda] = useState("");
  const [missing, setMissing] = useState(false);
  const titleId = useId();
  const timesId = useId();
  const modeName = useId();
  const slotName = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (choose.isPending) return;
    const picked = slots.find((s) => s.id === slotId);
    if (!picked) {
      setMissing(true);
      return;
    }
    choose.mutate({
      slotId: picked.id,
      mode,
      place: place.trim() || undefined,
      agenda: agenda.trim() || undefined,
    });
  };

  const count = slots.length === 1 ? "a time" : `${slots.length} times`;
  return (
    <article className="pn-meeting-block" aria-labelledby={titleId}>
      <h3 id={titleId}>
        {first} proposed {count}
      </h3>
      <p className="t-small text-fg-2 mt-2">Choose the one that suits you. {first} is told, and the other times close.</p>
      <form className="pn-meeting-form grid gap-5 mt-4" noValidate onSubmit={submit}>
        <fieldset className="pn-fieldset" role="radiogroup" aria-describedby={missing ? timesId : undefined}>
          <legend className="t-small">Choose a time</legend>
          <div className="pn-options">
            {slots.map((slot) => (
              <Option
                key={slot.id}
                name={slotName}
                checked={slotId === slot.id}
                title={fmtMeetingSpan(slot.startsAt, slot.endsAt)}
                onClick={() => {
                  setSlotId(slot.id);
                  setMissing(false);
                }}
              />
            ))}
          </div>
          {missing ? (
            <p id={timesId} className="pn-field-hint pn-time-row-error" role="alert">
              Choose one of the times.
            </p>
          ) : null}
        </fieldset>
        <fieldset className="pn-fieldset" role="radiogroup">
          <legend className="t-small">How you will meet</legend>
          <div className="pn-options pn-options-2">
            <Option
              name={modeName}
              checked={mode === "online"}
              title="Online"
              note="A video or phone call"
              onClick={() => setMode("online")}
            />
            <Option
              name={modeName}
              checked={mode === "in-person"}
              title="In person"
              note="Somewhere public you both know"
              onClick={() => setMode("in-person")}
            />
          </div>
        </fieldset>
        <Field
          label="Where"
          optional
          hint={mode === "online" ? "A video link, or who sends one. Only the two of you see it." : "A public place. Only the two of you see it."}
        >
          {(id) => (
            <Input id={id} value={place} maxLength={fieldLimits.meetingPlace.max} onChange={(e) => setPlace(e.currentTarget.value)} />
          )}
        </Field>
        <Field label="What you want to cover" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={agenda}
              maxLength={fieldLimits.meetingAgenda.max}
              onChange={(e) => setAgenda(e.currentTarget.value)}
            />
          )}
        </Field>
        {choose.isError ? (
          <p className="t-small" role="alert">
            {meetingErrorText(choose.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-solid btn-sm" disabled={choose.isPending} aria-busy={choose.isPending || undefined}>
            {choose.isPending ? "Confirming" : "Confirm this time"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onProposeOther}>
            Propose other times
          </button>
        </div>
      </form>
    </article>
  );
}

/* ----------------------------------------------------- my times: waiting */

function Waiting({ slots, first, onChange }: { slots: Slot[]; first: string; onChange: () => void }) {
  const sent = slots.reduce((latest, s) => (s.createdAt > latest ? s.createdAt : latest), slots[0].createdAt);
  return (
    <article className="pn-meeting-block">
      <h3>Waiting for {first} to choose</h3>
      <ul className="pn-meeting-times t-body">
        {slots.map((slot) => (
          <li key={slot.id}>{fmtMeetingSpan(slot.startsAt, slot.endsAt)}</li>
        ))}
      </ul>
      <p className="t-small text-fg-2 mt-3">
        You proposed {slots.length === 1 ? "this" : "these"} on {fmtMeetingDay(sent)}, and {first} was told. Sending new times
        replaces them.
      </p>
      <div className="pn-meeting-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onChange}>
          Change the times
        </button>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- history */

function Earlier({ meetings, first }: { meetings: Meeting[]; first: string }) {
  const [asking, setAsking] = useState<string | null>(null);
  const titleId = useId();
  return (
    <div className="pn-meeting-block">
      <h3 id={titleId}>Earlier meetings</h3>
      <ul className="pn-meeting-history" aria-labelledby={titleId}>
        {meetings.map((m) => (
          <li key={m.id}>
            <span className="min-w-0">
              {meetingSpan(m)}
              <span className="block t-small text-fg-2">
                {fmtDuration(m.durationMin)} · {MODE_LABEL[m.mode]}
              </span>
            </span>
            <span className="t-small text-right">
              {meetingOutcomeLabel(m, first)}
              {m.met !== null && asking !== m.id ? (
                <button type="button" className="link link-quiet t-small block ml-auto" onClick={() => setAsking(m.id)}>
                  Change answer
                </button>
              ) : null}
            </span>
            {asking === m.id ? (
              <div className="col-span-2 mt-2">
                <OutcomeQuestion meeting={m} first={first} heading={false} onAnswered={() => setAsking(null)} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- panel */

export function MeetingsPanel({
  requestId,
  first,
  active,
  preferredMode,
}: {
  /** The accepted (or completed) request the relationship belongs to. */
  requestId: string;
  /** The other party's first name. */
  first: string;
  /** Accepted, not completed: new times can be proposed and chosen. */
  active: boolean;
  /** The request's mode, to preselect online or in person. */
  preferredMode: MeetingMode;
}) {
  const slotsQuery = useOpenSlots(requestId);
  const meetingsQuery = useRelationshipMeetings(requestId);
  const [proposing, setProposing] = useState(false);

  const view = useMemo(() => {
    const now = Date.now();
    const slots = slotsQuery.data?.items ?? [];
    const meetings = meetingsQuery.data?.items ?? [];
    const future = (s: Slot) => s.status === "proposed" && Date.parse(s.startsAt) > now;
    const comingUp = (m: Meeting) => m.status === "upcoming" && Date.parse(m.startsAt) > now;
    return {
      awaiting: meetings.filter((m) => m.awaitingOutcome).sort(byStart),
      upcoming: meetings.filter(comingUp).sort(byStart),
      earlier: meetings.filter((m) => !m.awaitingOutcome && !comingUp(m)).sort((a, b) => byStart(b, a)),
      theirs: slots.filter((s) => s.proposedBy === "them" && future(s)).sort(byStart),
      mine: slots.filter((s) => s.proposedBy === "me" && future(s)).sort(byStart),
    };
  }, [slotsQuery.data, meetingsQuery.data]);

  const failed = slotsQuery.isError || meetingsQuery.isError;
  const loading = !failed && (slotsQuery.isPending || meetingsQuery.isPending);
  const nothing =
    view.awaiting.length + view.upcoming.length + view.earlier.length + view.theirs.length + view.mine.length === 0;

  let body;
  if (failed) {
    body = (
      <Notice tone="warn">
        <p>The meetings did not load. Check your connection and try again.</p>
        <button
          type="button"
          className="btn btn-outline btn-sm mt-3"
          onClick={() => {
            void slotsQuery.refetch();
            void meetingsQuery.refetch();
          }}
        >
          Try again
        </button>
      </Notice>
    );
  } else if (loading) {
    body = (
      <p className="t-small text-fg-2" role="status">
        Loading meetings
      </p>
    );
  } else {
    body = (
      <div className="pn-meetings">
        {view.awaiting.map((m) => (
          <OutcomeQuestion key={m.id} meeting={m} first={first} />
        ))}
        {view.upcoming.map((m, i) => (
          <UpcomingMeeting key={m.id} meeting={m} first={first} title={i === 0 ? "Next meeting" : "Coming up"} />
        ))}
        {active && view.theirs.length > 0 ? (
          <ChooseTime
            // A new proposal starts a fresh choice.
            key={view.theirs.map((s) => s.id).join(",")}
            requestId={requestId}
            slots={view.theirs}
            first={first}
            preferredMode={preferredMode}
            onProposeOther={() => setProposing(true)}
          />
        ) : null}
        {active && view.mine.length > 0 ? <Waiting slots={view.mine} first={first} onChange={() => setProposing(true)} /> : null}
        {active && view.theirs.length === 0 && view.mine.length === 0 ? (
          <div className="pn-meeting-block">
            {nothing ? (
              <p className="t-body">No meetings yet. Propose up to three times and {first} chooses one.</p>
            ) : null}
            <div className={nothing ? "pn-meeting-actions" : undefined}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setProposing(true)}>
                <CalendarPlus size={15} aria-hidden="true" />
                Propose times
              </button>
            </div>
          </div>
        ) : null}
        {!active && nothing ? <p className="t-body text-fg-2">No meetings were arranged here.</p> : null}
        {view.earlier.length > 0 ? <Earlier meetings={view.earlier} first={first} /> : null}
      </div>
    );
  }

  return (
    <section aria-label="Meetings">
      <Card as="div" title="Meetings">
        {body}
        <p className="t-small text-fg-2 mt-5">Times are in Louisiana time (Central).</p>
      </Card>
      {active ? (
        <ProposeTimesDialog open={proposing} onClose={() => setProposing(false)} requestId={requestId} first={first} />
      ) : null}
    </section>
  );
}
