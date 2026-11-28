/**
 * The two-question feedback form (Task 32, REL-8) on a completed request,
 * for the mentee (`/network/me/requests/:id`) and the mentor
 * (`/network/mentor/mentees/:id`). Each party answers once: how helpful it
 * was, and anything to add. Once sent, the card shows the caller's own
 * answer. The other party never sees it; administrators read it without a
 * name. Nothing renders while the relationship is still active.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { fieldLimits } from "@shared/limits";
import type { RequestKind } from "@shared/types/common";
import { isApiError } from "../../lib/api";
import { Card, Field, Notice, Textarea } from "../../ui/ui";
import { HELPFUL_LABELS, HelpfulScale } from "../../ui/feedback-scale";
import { CharCount } from "../../ui/settings-controls";
import { useFeedback, useLeaveFeedback } from "./api";

function sendError(error: unknown): string {
  if (isApiError(error, "not_completed")) return "This is not marked as completed yet, so there is nothing to answer.";
  if (isApiError(error, "validation")) return "Check your answers and try again.";
  if (isApiError(error, "network")) return "That did not go through. Check your connection and try again.";
  return "That did not go through. Try again in a moment.";
}

export function FeedbackCard({
  requestId,
  otherFirstName,
  kind,
  focusOnMount = false,
}: {
  requestId: string;
  otherFirstName: string;
  kind: RequestKind;
  /** Move focus here when it appears, as right after "Mark as completed". */
  focusOnMount?: boolean;
}) {
  const feedback = useFeedback(requestId);
  const leave = useLeaveFeedback(requestId);
  const [helpful, setHelpful] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const noun = kind === "introduction" ? "introduction" : "mentorship";
  const state = feedback.data?.state;

  useEffect(() => {
    if (!focusOnMount || state !== "open" || focused.current) return;
    // After this commit's other effects: closing the confirmation dialog
    // hands focus back to the button that opened it, which is gone by now.
    const timer = window.setTimeout(() => {
      focused.current = true;
      headingRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusOnMount, state]);

  if (!feedback.data || state === "unavailable") return null;

  if (state === "left" && feedback.data.mine) {
    const mine = feedback.data.mine;
    return (
      <section aria-labelledby={`feedback-${requestId}`}>
        <Card lift as="div">
          <h2 id={`feedback-${requestId}`} className="t-heading">
            Your feedback
          </h2>
          <p className="t-body mt-3 pn-feedback-answer">
            <Check size={16} aria-hidden="true" className="text-accent shrink-0 self-center" />
            <span>
              You rated it {mine.helpful} of 5: {HELPFUL_LABELS[mine.helpful] ?? ""}.
            </span>
          </p>
          {mine.comment ? <p className="t-body text-fg-2 mt-3 whitespace-pre-line">{mine.comment}</p> : null}
          <p className="t-small text-fg-2 mt-4">
            Thank you. {otherFirstName} never sees it; MEST administrators read it without your name.
          </p>
        </Card>
      </section>
    );
  }

  const tooLong = Array.from(comment.trim()).length > fieldLimits.feedbackComment.max;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (helpful === null) {
      setMissing(true);
      return;
    }
    if (tooLong) return;
    leave.mutate({ helpful, comment: comment.trim() === "" ? undefined : comment.trim() });
  }

  return (
    <section aria-labelledby={`feedback-${requestId}`}>
      <Card accent as="div">
        <h2 id={`feedback-${requestId}`} ref={headingRef} tabIndex={-1} className="t-heading">
          How did it go?
        </h2>
        <p className="t-small text-fg-2 mt-2">
          Two short questions help MEST improve mentoring. {otherFirstName} never sees your answers; administrators read
          them without your name.
        </p>
        <form className="grid gap-5 mt-5" noValidate onSubmit={submit}>
          <HelpfulScale
            legend={`How helpful was this ${noun}?`}
            value={helpful}
            onChange={(n) => {
              setHelpful(n);
              setMissing(false);
            }}
            error={missing ? "Choose how helpful it was." : null}
          />
          <Field
            label="Anything you want to add?"
            optional
            hint={<CharCount value={comment} max={fieldLimits.feedbackComment.max} />}
          >
            {(id) => (
              <Textarea
                id={id}
                rows={4}
                value={comment}
                aria-invalid={tooLong || undefined}
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
          {leave.isError ? (
            <div role="alert">
              <Notice tone="warn">{sendError(leave.error)}</Notice>
            </div>
          ) : null}
          <div>
            <button type="submit" className="btn btn-solid btn-sm" disabled={leave.isPending || tooLong}>
              Send feedback
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
