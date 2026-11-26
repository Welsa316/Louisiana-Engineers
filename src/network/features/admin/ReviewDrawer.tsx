/**
 * One submission in the approval queue (03 section 8.1): the profile as it
 * was submitted, the sign-up address's domain (never the address), earlier
 * reviews of the same member, affiliation verification, and the decision.
 * Declining needs notes, because the member receives them. Contact details
 * and the LinkedIn link are not shown: administrators have no contact access.
 */

import { useId, useRef, useState, type RefObject } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { limits } from "@shared/limits";
import { participationOptions, topicById, verifiedMethodOptions, audiences } from "@shared/taxonomy";
import type { AdminReviewDetail } from "@shared/types/admin";
import type { ReviewDecision, VerifiedMethod } from "@shared/types/common";
import { Drawer, Monogram, Notice, Select, Status, fmtDate } from "../../ui/ui";
import { adminErrorText, personInitials, personName, useAdminAction, useReview } from "./api";

const VISIBILITY_LABEL = { public: "Public", members: "Members only", hidden: "Hidden" } as const;

export function ReviewDrawer({
  reviewId,
  onClose,
  onDecided,
}: {
  reviewId: string | undefined;
  onClose: () => void;
  /** After a decision, with the sentence to confirm it. */
  onDecided: (text: string) => void;
}) {
  const review = useReview(reviewId);
  const data = review.data;
  const [notes, setNotes] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const decide = useAdminAction((v: { decision: ReviewDecision; notes: string }) => ({
    path: `/admin/reviews/${reviewId}`,
    method: "POST",
    body: v.notes.trim() ? { decision: v.decision, notes: v.notes.trim() } : { decision: v.decision },
  }));

  // The dialog's own close event also lands here when the route has already
  // moved on; only a drawer that is still meant to be open navigates.
  const close = () => {
    if (reviewId) onClose();
  };

  const submit = (decision: ReviewDecision) => {
    if (!data) return;
    if (decision === "declined" && !notes.trim()) {
      setNotesError("Write what needs to change. The member receives these notes.");
      notesRef.current?.focus();
      return;
    }
    setNotesError(null);
    decide.mutate(
      { decision, notes },
      {
        onSuccess: () => {
          setNotes("");
          onDecided(
            decision === "approved"
              ? `${personName(data)} is approved and listed.`
              : `${personName(data)} was sent back with your notes.`,
          );
        },
      },
    );
  };

  const pending = data?.decision === null;

  return (
    <Drawer
      open={Boolean(reviewId)}
      onClose={close}
      title={data ? personName(data) : "Submission"}
      footer={
        data && pending ? (
          <div className="pn-admin-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={decide.isPending}
              onClick={() => submit("declined")}
            >
              <X size={15} aria-hidden="true" />
              Decline with notes
            </button>
            <button
              type="button"
              className="btn btn-solid btn-sm"
              disabled={decide.isPending}
              aria-busy={decide.isPending || undefined}
              onClick={() => submit("approved")}
            >
              <Check size={15} aria-hidden="true" />
              Approve and list
            </button>
          </div>
        ) : undefined
      }
    >
      {review.isError ? (
        <div role="alert">
          <Notice tone="warn">{adminErrorText(review.error)}</Notice>
        </div>
      ) : !data ? (
        <p className="t-small text-fg-2">Loading the submission</p>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <ReviewBody data={data} />
          {pending ? (
            <section>
              <h3 className="pn-kicker pn-kicker-plain mb-3">Decision</h3>
              <DecisionNotes
                value={notes}
                onChange={setNotes}
                error={notesError}
                inputRef={notesRef}
              />
              {decide.isError ? (
                <div role="alert" className="mt-4">
                  <Notice tone="warn">{adminErrorText(decide.error)}</Notice>
                </div>
              ) : null}
            </section>
          ) : (
            <section>
              <h3 className="pn-kicker pn-kicker-plain mb-3">Decision</h3>
              <p className="t-body">
                <Status
                  tone={data.decision === "approved" ? "approved" : "declined"}
                  label={data.decision === "approved" ? "Listed" : "Needs changes"}
                />
                {data.decidedAt ? <span className="t-small text-fg-2"> on {fmtDate(data.decidedAt, true)}</span> : null}
              </p>
              {data.notes ? <p className="t-body mt-3">{data.notes}</p> : null}
              {data.decision === "declined" && data.approvalState === "pending" ? (
                <div className="mt-4">
                  <Notice tone="info">This member has submitted again. The newer submission is in the Waiting tab.</Notice>
                </div>
              ) : null}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function DecisionNotes({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  return (
    <div className="field">
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        Notes
      </label>
      {/* A native textarea with the shared classes: the ui Textarea does not forward a ref. */}
      <textarea
        className="field-input pn-textarea"
        ref={inputRef}
        id={id}
        rows={4}
        maxLength={limits.reportDetail.max}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={hintId} className="pn-field-hint">
        Required to decline: the member receives them and can edit and submit again. Optional when approving, for the
        record.
      </p>
      {error ? (
        <p id={errorId} role="alert" className="field-error t-small">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewBody({ data }: { data: AdminReviewDetail }) {
  const s = data.snapshot;
  const mentoring = s.mentorship && s.mentorship.status !== "off" ? s.mentorship : null;
  return (
    <>
      <div className="flex items-start gap-4">
        <Monogram initials={personInitials(data)} size="lg" />
        <div className="min-w-0">
          <div className="pn-row-title">{s.title ?? data.title}</div>
          <div className="pn-row-meta">{[s.organization ?? data.organization, s.location].filter(Boolean).join(" · ")}</div>
          <div className="pn-tags mt-3">
            {data.disciplineLabel ? <span className="pn-tag pn-tag-quiet">{data.disciplineLabel}</span> : null}
            {typeof s.yearsExperience === "number" ? (
              <span className="pn-tag pn-tag-quiet">{s.yearsExperience} yrs</span>
            ) : null}
            <span className="pn-tag pn-tag-quiet">{VISIBILITY_LABEL[s.visibility ?? data.visibility]}</span>
          </div>
        </div>
      </div>

      {data.adminHidden ? (
        <Notice tone="warn">An administrator has hidden this profile. Restore it from Members to list it again.</Notice>
      ) : null}

      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Biography</h3>
        <p className="t-body">{s.bio ?? "No biography given."}</p>
      </section>

      {s.expertise?.length ? (
        <section>
          <h3 className="pn-kicker pn-kicker-plain mb-3">Expertise</h3>
          <div className="pn-tags">
            {s.expertise.map((e) => (
              <span key={e} className="pn-tag">
                {e}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {s.education?.length ? (
        <section>
          <h3 className="pn-kicker pn-kicker-plain mb-3">Education</h3>
          <ul className="pn-edu">
            {s.education.map((e) => (
              <li key={`${e.degree}-${e.school}-${e.year}`} className="pn-edu-item">
                <span className="pn-edu-year t-numeral">{e.year}</span>
                <span>
                  {e.degree} {e.field}, {e.school}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.participation?.length ? (
        <section>
          <h3 className="pn-kicker pn-kicker-plain mb-3">Taking part in</h3>
          <p className="t-small text-fg-2">
            {s.participation
              .map((id) => participationOptions.find((o) => o.id === id)?.label ?? id)
              .join(", ")}
          </p>
        </section>
      ) : null}

      {mentoring ? (
        <section>
          <h3 className="pn-kicker pn-kicker-plain mb-3">Wants to mentor</h3>
          <p className="t-small text-fg-2">
            {(mentoring.topics ?? []).map((t) => topicById(t)?.label ?? t).join(", ")}
            {mentoring.audience.length
              ? ` · for ${mentoring.audience.map((a) => audiences.find((o) => o.id === a)?.label ?? a).join(", ")}`
              : ""}
            {` · up to ${mentoring.maxActive} at once`}
            {mentoring.availability ? ` · ${mentoring.availability}` : ""}
          </p>
        </section>
      ) : null}

      <Verification data={data} />

      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Private to administrators</h3>
        <dl className="pn-dl t-small">
          <dt>Sign-up domain</dt>
          <dd>{data.emailDomain ?? "Not available"}</dd>
          <dt>Joined</dt>
          <dd>{fmtDate(data.joinedAt, true)}</dd>
          <dt>Submitted</dt>
          <dd>{fmtDate(data.submittedAt, true)}</dd>
        </dl>
        {data.history.length ? (
          <div className="mt-4">
            <h4 className="t-small text-fg-2 mb-2">Earlier reviews</h4>
            <ul className="grid gap-3">
              {data.history.map((h) => (
                <li key={h.id} className="t-small">
                  <Status
                    tone={h.decision === "approved" ? "approved" : h.decision === "declined" ? "declined" : "pending"}
                    label={h.decision === "approved" ? "Listed" : h.decision === "declined" ? "Needs changes" : "Waiting"}
                  />{" "}
                  <span className="text-fg-2">{fmtDate(h.decidedAt ?? h.submittedAt, true)}</span>
                  {h.notes ? <p className="mt-1">{h.notes}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}

/** Marks the affiliation verified by one method, or clears it. Independent of approval. */
function Verification({ data }: { data: AdminReviewDetail }) {
  const selectId = useId();
  const [method, setMethod] = useState<VerifiedMethod>(data.verifiedMethod ?? "work_email");
  const action = useAdminAction((m: VerifiedMethod | null) => ({
    path: `/admin/profiles/${data.profileId}/verified`,
    method: "POST",
    body: { method: m },
  }));
  const label = verifiedMethodOptions.find((o) => o.id === data.verifiedMethod)?.label;

  return (
    <section>
      <h3 className="pn-kicker pn-kicker-plain mb-3">Verification</h3>
      <p className="t-small text-fg-2">
        {data.verified
          ? `Affiliation verified (${label ?? "method not recorded"}).`
          : "The sign-up domain and organization are the signals. Mark verified only when the affiliation checks out."}
      </p>
      {data.verified ? (
        <button
          type="button"
          className="btn btn-outline btn-xs mt-3"
          disabled={action.isPending}
          onClick={() => action.mutate(null)}
        >
          Clear verification
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="field">
            <label className="field-label pn-field-label t-small" htmlFor={selectId}>
              Verified by
            </label>
            <Select id={selectId} value={method} onChange={(e) => setMethod(e.currentTarget.value as VerifiedMethod)}>
              {verifiedMethodOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={action.isPending}
            onClick={() => action.mutate(method)}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            Mark affiliation verified
          </button>
        </div>
      )}
      {action.isError ? (
        <div role="alert" className="mt-3">
          <Notice tone="warn">{adminErrorText(action.error)}</Notice>
        </div>
      ) : null}
    </section>
  );
}
