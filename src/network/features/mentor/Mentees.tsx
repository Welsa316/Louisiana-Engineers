/**
 * Mentees (`/network/mentor/mentees`, 03 section 7.3), ported from the
 * prototype: the requests the mentor accepted, from
 * `GET /api/requests?role=mentor&status=accepted`, as cards with the
 * member's name, the topic, the start date, the methods handed over (as
 * labels) and "Mark as completed", which frees a place. Completed ones
 * follow as a list. Phase 2 adds the meetings log under each card.
 */

import { useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import type { RequestSummary } from "@shared/types/requests";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Modal, Monogram, Notice, PageHead, fmtDate } from "../../ui/ui";
import { counterpartyFirstName, counterpartyInitials, counterpartyName, requestSubject } from "../me/Requests";
import { REQUESTS_PAGE_SIZE, useRequest, useRequestAction, useRequestList } from "../me/requests-api";
import { methodLabel } from "./RequestDrawer";
import { CapacityLine, MentorRequestRow } from "./Requests";

/** Accepted requests: at most the cap plus introductions, so one page of 50 holds them. */
const ACTIVE_PAGE_SIZE = 50;

export function completeErrorText(error: unknown): string {
  if (isApiError(error, "not_active")) return "This mentorship is already closed.";
  if (isApiError(error, "network")) return "That did not go through. Check your connection and try again.";
  return "That did not go through. Try again in a moment.";
}

/** The confirmation before a relationship is marked completed. */
export function CompleteDialog({
  open,
  onClose,
  first,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  first: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark this as completed?"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Keep it open
          </button>
          <button type="button" className="btn btn-solid btn-sm" disabled={pending} onClick={onConfirm}>
            Mark as completed
          </button>
        </>
      }
    >
      <p>
        {first} is told and asked for feedback, and the contact details you shared stop showing on their request. It
        frees a place for someone new. The request stays in both your histories.
      </p>
      {error ? (
        <p className="t-small mt-3" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function MenteeCard({ r }: { r: RequestSummary }) {
  const detail = useRequest(r.id);
  const complete = useRequestAction(r.id, "complete");
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const first = counterpartyFirstName(r.counterparty);
  const d = detail.data;
  const line = d?.mentee
    ? d.mentee.program
    : [r.counterparty.title, r.counterparty.organization].filter(Boolean).join(" · ");
  const shared = d?.relationship?.sharedMethods ?? [];
  const started = d?.relationship?.startedAt ?? r.respondedAt;

  return (
    <Card as="article">
      <div className="flex items-start gap-4">
        <Monogram initials={counterpartyInitials(r.counterparty)} student={r.counterparty.kind === "student"} />
        <div className="min-w-0 flex-1">
          <h3 className="pn-row-title">{counterpartyName(r.counterparty)}</h3>
          {line ? <p className="pn-row-meta">{line}</p> : null}
          <p className="t-small mt-3">{requestSubject(r)}</p>
          <p className="t-small text-fg-2 mt-1">{started ? `Started ${fmtDate(started, true)}` : "Started recently"}</p>
          {shared.length > 0 ? (
            <div className="mt-3">
              <span className="sr-only">You shared: </span>
              <div className="pn-tags">
                {shared.map((method) => (
                  <span key={method} className="pn-tag pn-tag-quiet">
                    {methodLabel(method)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-[var(--pn-line)]">
        <Link to={`/mentor/mentees/${r.id}`} className="btn btn-outline btn-sm">
          Open
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
          <Check size={14} aria-hidden="true" />
          Mark as completed
        </button>
      </div>
      <CompleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        first={first}
        pending={complete.isPending}
        error={complete.isError ? completeErrorText(complete.error) : null}
        onConfirm={() =>
          complete.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              // The two feedback questions wait on the mentorship's own page.
              navigate(`/mentor/mentees/${r.id}`, { state: { feedback: true } });
            },
          })
        }
      />
    </Card>
  );
}

export function Mentees() {
  useMeta({ title: "Mentees" });
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const active = useRequestList("mentor", ["accepted"], 1, ACTIVE_PAGE_SIZE);
  const completed = useRequestList("mentor", ["completed"], page);
  const activeId = useId();
  const completedId = useId();

  const pages = completed.data ? Math.max(1, Math.ceil(completed.data.total / REQUESTS_PAGE_SIZE)) : 1;
  const goTo = (next: number) => {
    const search = new URLSearchParams(params);
    if (next > 1) search.set("page", String(next));
    else search.delete("page");
    setParams(search);
  };
  const failed = active.error ?? completed.error;

  return (
    <>
      <PageHead
        kicker="Mentees"
        title="People you said yes to."
        lead="Mark a mentorship completed when it has run its course. That frees a place for someone new; either of you can do it."
        actions={
          <Link to="/mentor/requests" className="btn btn-outline btn-sm">
            Requests
          </Link>
        }
      />
      <CapacityLine className="mt-4" />
      {failed ? (
        <div className="mt-8">
          <Notice tone="warn">
            {isApiError(failed, "network")
              ? "Your mentees did not load. Check your connection and try again."
              : "Your mentees did not load. Try again in a moment."}
          </Notice>
        </div>
      ) : null}
      <div className="mt-8 grid gap-8">
        <section aria-labelledby={activeId}>
          <h2 id={activeId} className="t-label text-accent mb-4">
            Active{active.data ? ` · ${active.data.total}` : ""}
          </h2>
          {!active.data ? (
            <p className="t-small text-fg-2" role="status">
              Loading your mentees
            </p>
          ) : active.data.items.length > 0 ? (
            <div className="pn-grid pn-grid-2">
              {active.data.items.map((r) => (
                <MenteeCard key={r.id} r={r} />
              ))}
            </div>
          ) : (
            <Empty
              title="No active mentees."
              action={
                <Link to="/mentor/requests" className="btn btn-outline btn-sm">
                  See requests
                </Link>
              }
            >
              Accept a request and it appears here.
            </Empty>
          )}
        </section>
        {completed.data && completed.data.total > 0 ? (
          <section aria-labelledby={completedId}>
            <h2 id={completedId} className="t-label text-accent mb-4">
              Completed · {completed.data.total}
            </h2>
            <Card flush>
              <ul aria-label="Completed mentorships">
                {completed.data.items.map((r) => (
                  <MentorRequestRow key={r.id} r={r} to={`/mentor/mentees/${r.id}`} />
                ))}
              </ul>
            </Card>
            {pages > 1 ? (
              <nav className="flex items-center justify-between gap-4 mt-4 t-small" aria-label="Completed pages">
                <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                  Previous
                </button>
                <span className="text-fg-2">
                  Page {Math.min(page, pages)} of {pages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= pages}
                  onClick={() => goTo(page + 1)}
                >
                  Next
                </button>
              </nav>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
