/**
 * One mentorship the mentor accepted (`/network/mentor/mentees/:id`, where
 * `:id` is the request id), ported from the prototype's relationship
 * screen: the member, the request as written, what the mentor handed
 * over, the timeline and "Mark as completed". A pending or closed-unanswered
 * request belongs in the inbox, so it is sent there; the mentee of a
 * request is sent to their own view; anyone else gets "not available".
 * Phase 2 adds the meetings log here.
 */

import { useState } from "react";
import { Navigate, useParams } from "react-router";
import { Check, ShieldCheck } from "lucide-react";
import { audiences } from "@shared/taxonomy";
import type { RequestDetail } from "@shared/types/requests";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Monogram, fmtDate } from "../../ui/ui";
import { topicLabels } from "../public/Directory";
import {
  counterpartyFirstName,
  counterpartyInitials,
  counterpartyName,
  RequestStatusPill,
  requestSubject,
} from "../me/Requests";
import { useRequest, useRequestAction } from "../me/requests-api";
import { CompleteDialog, completeErrorText } from "./Mentees";
import { methodLabel } from "./RequestDrawer";
import { isLoadFailure, MentorBack, RequestNotAvailable } from "./Requests";

function Back() {
  return <MentorBack to="/mentor/mentees" label="All mentees" />;
}

function RelationshipView({ r }: { r: RequestDetail }) {
  const [confirming, setConfirming] = useState(false);
  const complete = useRequestAction(r.id, "complete");
  const first = counterpartyFirstName(r.counterparty);
  const name = counterpartyName(r.counterparty);
  const m = r.mentee;
  const rel = r.relationship;
  useMeta({ title: `${requestSubject(r)} with ${name}` });

  const subtitle = m
    ? [m.program, m.institution].filter(Boolean).join(" · ")
    : [r.counterparty.title, r.counterparty.organization].filter(Boolean).join(" · ");
  const completedWhen = r.completedAt ?? rel?.completedAt ?? null;
  const by = rel?.completedBy;

  const timeline: { when: string; what: string }[] = [{ when: fmtDate(r.createdAt), what: `${first} sent the request` }];
  if (r.respondedAt) timeline.push({ when: fmtDate(r.respondedAt), what: "You accepted" });
  if (r.status === "completed") {
    timeline.push({
      when: completedWhen ? fmtDate(completedWhen) : "",
      what: by === "me" ? "You marked it completed" : by === "them" ? `${first} marked it completed` : "Marked completed",
    });
  }

  return (
    <>
      <Back />
      <header className="pn-page-head mt-4">
        <div className="flex items-start gap-5 min-w-0">
          <Monogram initials={counterpartyInitials(r.counterparty)} size="lg" student={r.counterparty.kind === "student"} />
          <div className="min-w-0">
            <RequestStatusPill status={r.status} pill />
            <h1 className="mt-3">{name}</h1>
            <p>{subtitle ? `${requestSubject(r)} · ${subtitle}` : requestSubject(r)}</p>
          </div>
        </div>
        {r.status === "accepted" ? (
          <div className="pn-page-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirming(true)}>
              <Check size={15} aria-hidden="true" />
              Mark as completed
            </button>
          </div>
        ) : null}
      </header>

      <div className="pn-split mt-8">
        <div className="grid gap-6 content-start">
          {r.status === "completed" ? (
            <Card lift>
              <p className="t-body">
                {by === "me" ? "You" : by === "them" ? first : "One of you"} marked this as completed
                {completedWhen ? ` on ${fmtDate(completedWhen, true)}` : ""}. Thank you for taking part.
              </p>
            </Card>
          ) : null}
          <Card title="The request" flush>
            <div className="p-5 grid gap-3">
              <p className="t-heading">{requestSubject(r)}</p>
              {r.textPurged ? (
                <p className="t-small text-fg-2">
                  The text of this request was removed after the retention period. Its dates and status are kept.
                </p>
              ) : (
                <>
                  <p className="t-body whitespace-pre-line">{r.why}</p>
                  {r.goals && (
                    <p className="t-body text-fg-2 whitespace-pre-line">
                      <span className="text-fg">Success looks like:</span> {r.goals}
                    </p>
                  )}
                  {r.schedulingNote && <p className="t-small text-fg-2">{r.schedulingNote}</p>}
                </>
              )}
              {r.mentorNote && (
                <p className="t-small text-fg-2 border-t border-[var(--pn-line)] pt-3 whitespace-pre-line">
                  <span className="text-fg">Your note:</span> {r.mentorNote}
                </p>
              )}
            </div>
          </Card>
          {rel ? (
            <Card title="What you shared">
              {rel.sharedMethods.length > 0 ? (
                <div className="pn-tags">
                  {rel.sharedMethods.map((method) => (
                    <span key={method} className="pn-tag pn-tag-quiet">
                      {methodLabel(method)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="t-small text-fg-2">Nothing was handed over for this request.</p>
              )}
              <p className="t-small text-fg-2 mt-4">
                {r.status === "accepted"
                  ? `Only ${first} sees these, on their request, until one of you marks it completed.`
                  : "These are no longer shown now that it is completed."}
              </p>
              <p className="t-small text-fg-2 mt-3 inline-flex gap-2">
                <ShieldCheck size={15} aria-hidden="true" className="shrink-0 mt-0.5" />
                Meet in public places; MEST does not supervise meetings.
              </p>
            </Card>
          ) : null}
        </div>
        <div className="grid gap-6 content-start">
          {m ? (
            <Card title={`About ${first}`} lift>
              <p className="t-small whitespace-pre-line">{m.goals}</p>
              <dl className="pn-dl mt-4 t-small">
                <dt>Level</dt>
                <dd>{audiences.find((a) => a.id === m.level)?.label ?? ""}</dd>
                {m.interests.length > 0 ? (
                  <>
                    <dt>Interests</dt>
                    <dd>{m.interests.join(", ")}</dd>
                  </>
                ) : null}
                {m.topicsNeeded.length > 0 ? (
                  <>
                    <dt>Looking for</dt>
                    <dd>{topicLabels(m.topicsNeeded).join(", ")}</dd>
                  </>
                ) : null}
              </dl>
            </Card>
          ) : null}
          <Card title="Timeline" lift>
            <ul className="pn-timeline">
              {timeline.map((item) => (
                <li key={item.what} className="pn-timeline-item">
                  <span className="pn-timeline-when">{item.when}</span>
                  <span>{item.what}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <CompleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        first={first}
        pending={complete.isPending}
        error={complete.isError ? completeErrorText(complete.error) : null}
        onConfirm={() => complete.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}

export function Relationship() {
  const { id = "" } = useParams();
  const query = useRequest(id);

  if (query.isPending) {
    return (
      <>
        <Back />
        <div className="mt-8" role="status" aria-live="polite">
          <span className="sr-only">Loading the mentorship</span>
        </div>
      </>
    );
  }
  if (query.isError) {
    if (isLoadFailure(query.error)) {
      return (
        <>
          <Back />
          <div className="mt-8">
            <Empty
              title="The mentorship did not load."
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
    return <RequestNotAvailable back="/mentor/mentees" label="All mentees" />;
  }

  const r = query.data;
  if (r.role === "mentee") return <Navigate to={`/me/requests/${r.id}`} replace />;
  if (r.status !== "accepted" && r.status !== "completed") return <Navigate to={`/mentor/requests/${r.id}`} replace />;
  return <RelationshipView r={r} />;
}
