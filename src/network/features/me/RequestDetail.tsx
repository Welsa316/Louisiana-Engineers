/**
 * One request the caller sent (`/network/me/requests/:id`, 03 section 6.4),
 * ported from the prototype's request detail. `GET /api/requests/:id`
 * answers only the two parties; anyone else gets 404 and sees "not
 * available". The mentor of a request is sent to their own inbox view.
 *
 *   pending    Waiting for [name], expires [date]; Withdraw
 *   accepted   the mentor's note, How to reach [name] (the handoff), Mark as completed
 *   declined   the reason, and others who offer the same topic
 *   expired    no reply in time, said kindly, and others who offer the topic
 *   canceled   when it was sent and withdrawn
 *   completed  when, and who marked it
 *
 * Accepted and completed requests also carry the Meetings card (Task 31,
 * features/meetings/Scheduling.tsx), the same one the mentor sees.
 *
 * The request as written is shown below, unless the retention rule has
 * emptied it.
 */

import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { ArrowLeft, ArrowUpRight, Check, Clock, ShieldCheck } from "lucide-react";
import { declineReasonOptions } from "@shared/taxonomy";
import type { RequestDetail as Detail } from "@shared/types/requests";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Card, Empty, Modal, Monogram, Notice, fmtDate } from "../../ui/ui";
import { HandoffMethods } from "../../ui/requests-handoff";
import { displayName, initialsOf } from "../public/Directory";
import {
  counterpartyFirstName,
  counterpartyInitials,
  counterpartyName,
  RequestStatusPill,
  requestSubject,
} from "./Requests";
import { MeetingsPanel } from "../meetings/Scheduling";
import { useOwnProfile } from "./Home";
import { useRequest, useRequestAction, useSuggestedMentors } from "./requests-api";

const DAY_MS = 24 * 60 * 60 * 1000;

const MODE_PHRASE = { online: "online", "in-person": "in person", either: "online or in person" } as const;

function declineReasonLabel(reason: Detail["declineReason"]): string | null {
  if (!reason) return null;
  if (reason === "member_left") return "They left the network";
  return declineReasonOptions.find((o) => o.id === reason)?.label ?? null;
}

/** The request's own expiry window, in days, for the "no reply within" line. */
function expiryDays(r: Detail): number {
  return Math.max(1, Math.round((Date.parse(r.expiresAt) - Date.parse(r.createdAt)) / DAY_MS));
}

function Back() {
  return (
    <Link to="/me/requests" className="link link-quiet t-small">
      <ArrowLeft size={14} aria-hidden="true" />
      All requests
    </Link>
  );
}

function Suggestions({
  topicId,
  exclude,
  title,
  children,
}: {
  topicId: string | null;
  /** The mentor this request went to: "others" means someone else. */
  exclude: string;
  title: string;
  children: ReactNode;
}) {
  const suggested = useSuggestedMentors(topicId, true);
  const items = (suggested.data?.items ?? []).filter((p) => p.id !== exclude);
  return (
    <section aria-label="Others you could ask">
      <Card title={title}>
        <p className="t-body">{children}</p>
        {suggested.isPending ? (
          <p className="t-small text-fg-2 mt-4">Looking for mentors</p>
        ) : items.length > 0 ? (
          <ul className="pn-ledger mt-4">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={`/me/discover/${p.id}`} className="pn-row-link">
                  <Monogram initials={initialsOf(p)} photo={p.photoUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="pn-row-title block truncate">{displayName(p)}</span>
                    <span className="pn-row-meta block truncate">
                      {[p.title, p.organization].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" className="text-fg-2 max-md:hidden" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-small text-fg-2 mt-4">Nobody else is taking requests on this topic right now.</p>
        )}
        <Link to="/me/discover" className="btn btn-outline btn-sm mt-5">
          Find mentors
        </Link>
      </Card>
    </section>
  );
}

function StatusBlock({ r }: { r: Detail }) {
  const first = counterpartyFirstName(r.counterparty);
  switch (r.status) {
    case "pending":
      return (
        <Card lift>
          <div className="flex gap-4">
            <Clock size={20} aria-hidden="true" className="text-accent shrink-0 mt-0.5" />
            <p className="t-body">
              Waiting for {first}. Expires {fmtDate(r.expiresAt, true)}. {first} gets a reminder while it waits; if there
              is no answer by then, it closes and you can send another.
            </p>
          </div>
        </Card>
      );
    case "accepted":
      return (
        <section aria-label={`How to reach ${first}`}>
          <Card accent title={`How to reach ${first}`}>
            <p className="t-body">
              {first} accepted and shared {r.handoff && r.handoff.methods.length === 1 ? "this way" : "these ways"} to
              get in touch. Propose times to meet under Meetings, or agree the details directly.
            </p>
            <div className="mt-5">
              {r.handoff && r.handoff.methods.length > 0 ? (
                <HandoffMethods methods={r.handoff.methods} />
              ) : (
                <p className="t-small text-fg-2">
                  The contact details {first} shared are not available any more. You can still mark this as completed.
                </p>
              )}
            </div>
            <p className="t-small text-fg-2 mt-5 inline-flex gap-2">
              <ShieldCheck size={15} aria-hidden="true" className="shrink-0 mt-0.5" />
              Meet in public places; MEST does not supervise meetings.
            </p>
          </Card>
        </section>
      );
    case "declined": {
      const reason = declineReasonLabel(r.declineReason);
      return (
        <Suggestions topicId={r.topicId} exclude={r.counterparty.id} title="You can ask someone else">
          {first} could not take this one{reason ? "" : "."}
          {reason ? (
            <>
              : <span className="text-fg">{reason}</span>.
            </>
          ) : null}{" "}
          It does not count against your open requests. Here are others who take requests
          {r.topicId ? " on the same topic" : ""}.
        </Suggestions>
      );
    }
    case "expired":
      return (
        <Suggestions topicId={r.topicId} exclude={r.counterparty.id} title="Others who could help">
          No reply within {expiryDays(r)} days. Mentors are volunteers and sometimes miss a request. Here are others who
          {r.topicId ? " offer the same topic" : " take requests"}.
        </Suggestions>
      );
    case "canceled":
      return (
        <Card lift>
          <p className="t-body">
            You withdrew this request{r.respondedAt ? ` on ${fmtDate(r.respondedAt, true)}` : ""}. {first} was told there
            is nothing to do. You can send a new request at any time.
          </p>
        </Card>
      );
    case "completed": {
      const by = r.relationship?.completedBy;
      const when = r.completedAt ?? r.relationship?.completedAt;
      return (
        <Card lift>
          <p className="t-body">
            {by === "me" ? "You" : by === "them" ? first : "One of you"} marked this as completed
            {when ? ` on ${fmtDate(when, true)}` : ""}.
          </p>
        </Card>
      );
    }
  }
}

function Thread({ r, myInitials, student }: { r: Detail; myInitials: string; student: boolean }) {
  const name = counterpartyName(r.counterparty);
  return (
    <Card title="Your request" flush>
      {r.textPurged ? (
        <p className="t-small text-fg-2 p-5">
          The text of this request was removed after the retention period. Its dates and status are kept.
        </p>
      ) : (
        <div className="pn-thread p-5">
          <div className="pn-msg">
            <Monogram initials={myInitials} size="sm" student={student} />
            <div className="min-w-0">
              <div className="pn-msg-head">
                <strong>You</strong>
                <span>{fmtDate(r.createdAt)}</span>
              </div>
              <p className="whitespace-pre-line">{r.why}</p>
              {r.goals && (
                <p className="text-fg-2 whitespace-pre-line">
                  <span className="text-fg">Success looks like:</span> {r.goals}
                </p>
              )}
              <p className="text-fg-2 t-small">
                {r.format === "one-time" ? "One conversation" : "Recurring"} · {MODE_PHRASE[r.mode]}
                {r.schedulingNote && ` · ${r.schedulingNote}`}
              </p>
            </div>
          </div>
          {r.mentorNote && (
            <div className="pn-msg pn-msg-mentor">
              <Monogram initials={counterpartyInitials(r.counterparty)} size="sm" />
              <div className="min-w-0">
                <div className="pn-msg-head">
                  <strong>{name}</strong>
                  <span>{r.respondedAt && fmtDate(r.respondedAt)}</span>
                </div>
                <p className="whitespace-pre-line">{r.mentorNote}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Timeline({ r }: { r: Detail }) {
  const first = counterpartyFirstName(r.counterparty);
  const items: { when: string; what: string }[] = [{ when: fmtDate(r.createdAt), what: "Request sent" }];
  if (r.status === "accepted" || r.status === "completed") {
    if (r.respondedAt) items.push({ when: fmtDate(r.respondedAt), what: `${first} accepted` });
  }
  if (r.status === "declined" && r.respondedAt) items.push({ when: fmtDate(r.respondedAt), what: `${first} declined` });
  if (r.status === "canceled") {
    items.push({ when: r.respondedAt ? fmtDate(r.respondedAt) : "", what: "You withdrew the request" });
  }
  if (r.status === "completed") {
    const when = r.completedAt ?? r.relationship?.completedAt;
    items.push({ when: when ? fmtDate(when) : "", what: "Marked completed" });
  }
  if (r.status === "expired") items.push({ when: fmtDate(r.expiresAt), what: "Closed without a reply" });
  if (r.status === "pending") items.push({ when: fmtDate(r.expiresAt), what: "Expires if there is no answer" });
  return (
    <Card title="Timeline" lift>
      <ul className="pn-timeline">
        {items.map((item) => (
          <li key={item.what} className="pn-timeline-item">
            <span className="pn-timeline-when">{item.when}</span>
            <span>{item.what}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Confirm({
  open,
  onClose,
  title,
  confirm,
  danger = false,
  pending,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  confirm: string;
  danger?: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger btn-sm" : "btn btn-solid btn-sm"}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p>{children}</p>
      {error ? (
        <p className="t-small mt-3" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function actionError(error: unknown): string {
  if (isApiError(error, "not_pending")) return "This request was answered in the meantime. The page now shows where it stands.";
  if (isApiError(error, "not_active")) return "This mentorship is already closed.";
  if (isApiError(error, "network")) return "That did not go through. Check your connection and try again.";
  return "That did not go through. Try again in a moment.";
}

function DetailView({ r }: { r: Detail }) {
  const { user } = useSession();
  const own = useOwnProfile();
  const location = useLocation();
  const sentTo = (location.state as { sent?: string } | null)?.sent;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const cancel = useRequestAction(r.id, "cancel");
  const complete = useRequestAction(r.id, "complete");
  const first = counterpartyFirstName(r.counterparty);
  const name = counterpartyName(r.counterparty, true);
  const subtitle = `${requestSubject(r)} · sent ${fmtDate(r.createdAt)}${r.status === "pending" ? ` · expires ${fmtDate(r.expiresAt)}` : ""}`;
  useMeta({ title: `${requestSubject(r)} with ${counterpartyName(r.counterparty)}` });

  const myInitials = own.data ? initialsOf(own.data) : "Y";

  return (
    <>
      <Back />
      {sentTo && r.status === "pending" ? (
        <div className="mt-4" role="status">
          <Notice tone="ok" icon={<Check size={16} aria-hidden="true" />}>
            <strong>Request sent to {sentTo}.</strong> {sentTo} will see your profile and message and answer by{" "}
            {fmtDate(r.expiresAt, true)}. You get an email with the answer; there is no need to follow up.
          </Notice>
        </div>
      ) : null}
      <header className="pn-page-head mt-4">
        <div className="flex items-start gap-5 min-w-0">
          <Monogram initials={counterpartyInitials(r.counterparty)} size="lg" />
          <div className="min-w-0">
            <RequestStatusPill status={r.status} pill />
            <h1 className="mt-3">{name}</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="pn-page-actions">
          {!r.counterparty.former && (
            <Link to={`/me/discover/${r.counterparty.id}`} className="btn btn-outline btn-sm">
              View profile
            </Link>
          )}
          {r.status === "pending" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(true)}>
              Withdraw
            </button>
          )}
          {r.status === "accepted" && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmComplete(true)}>
              <Check size={15} aria-hidden="true" />
              Mark as completed
            </button>
          )}
        </div>
      </header>

      <div className="pn-split mt-8">
        <div className="grid gap-6 content-start">
          <StatusBlock r={r} />
          {r.status === "accepted" || r.status === "completed" ? (
            <MeetingsPanel requestId={r.id} first={first} active={r.status === "accepted"} preferredMode={r.mode} />
          ) : null}
          <Thread r={r} myInitials={myInitials} student={user?.kind === "student"} />
        </div>
        <div className="grid gap-6 content-start">
          <Timeline r={r} />
        </div>
      </div>

      <Confirm
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Withdraw this request?"
        confirm="Withdraw"
        danger
        pending={cancel.isPending}
        error={cancel.isError ? actionError(cancel.error) : null}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setConfirmCancel(false) })}
      >
        {first} will no longer see it as waiting. You can send a new request later.
      </Confirm>
      <Confirm
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Mark this as completed?"
        confirm="Mark as completed"
        pending={complete.isPending}
        error={complete.isError ? actionError(complete.error) : null}
        onConfirm={() => complete.mutate(undefined, { onSuccess: () => setConfirmComplete(false) })}
      >
        {first} is told in the app. The request stays in your history, and you can send {first} a new one later.
      </Confirm>
    </>
  );
}

export function RequestDetail() {
  const { id = "" } = useParams();
  const query = useRequest(id);

  if (query.isPending) {
    return (
      <>
        <Back />
        <div className="mt-8" role="status" aria-live="polite">
          <span className="sr-only">Loading the request</span>
        </div>
      </>
    );
  }
  if (query.isError) {
    if (isApiError(query.error, "network") || (isApiError(query.error) && query.error.status >= 500)) {
      return (
        <>
          <Back />
          <div className="mt-8">
            <Empty
              title="The request did not load."
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void query.refetch()}>
                  Try again
                </button>
              }
            >
              Check your connection and try again.
            </Empty>
          </div>
        </>
      );
    }
    return <NotAvailable />;
  }

  // The mentor of this request answers it from their own inbox.
  if (query.data.role === "mentor") return <Navigate to={`/mentor/requests/${query.data.id}`} replace />;
  return <DetailView r={query.data} />;
}

function NotAvailable() {
  useMeta({ title: "Request not available" });
  return (
    <>
      <Back />
      <div className="mt-8 max-w-2xl">
        <h1 className="t-display-sm">This request is not available.</h1>
        <p className="t-body text-fg-2 mt-4">
          The link may be mistyped, or the request belongs to someone else. Requests are visible only to the two people
          in them.
        </p>
      </div>
    </>
  );
}
