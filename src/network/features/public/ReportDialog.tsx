/**
 * The report control on a profile (03 section 6.2, requirement ADM-4): a
 * quiet "Report" button for signed-in members that opens a dialog with the
 * reason and an optional detail, then `POST /api/profiles/:id/report`.
 * `ProfileActions` shows it only to members who are not the owner, through
 * `reportSlot`; the reported member never learns who reported them.
 */

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { limits } from "@shared/limits";
import { reportReasonOptions } from "@shared/taxonomy";
import type { ProfileView } from "@shared/types/directory";
import type { ReportReason } from "@shared/types/common";
import type { ReportCreated } from "@shared/types/reports";
import { api, isApiError } from "../../lib/api";
import { CharCount } from "../../ui/settings-controls";
import { Modal, Notice, Option, Textarea } from "../../ui/ui";
import type { ProfileSlot } from "./ProfileActions";

/** Plain-language text for a refused report. */
function reportErrorText(error: unknown): string {
  if (isApiError(error, "rate_limited")) {
    return "You have sent as many reports as one day allows. If this is urgent, write to the MEST team.";
  }
  if (isApiError(error, "not_found")) return "This profile is no longer available, so there is nothing to report.";
  if (isApiError(error, "not_member") || isApiError(error, "unauthenticated")) {
    return "Only signed-in members can send a report. Sign in again and try once more.";
  }
  if (isApiError(error, "validation")) return error.issues[0]?.message ?? "Check the reason and the detail and try again.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and the report was not sent. Try again in a few minutes.";
}

export function ReportControl({ profile }: { profile: ProfileView }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      api<ReportCreated>(`/profiles/${encodeURIComponent(profile.id)}/report`, {
        method: "POST",
        body: { reason, ...(detail.trim() ? { detail: detail.trim() } : {}) },
      }),
    onSuccess: () => {
      setOpen(false);
      setSent(true);
      setReason(null);
      setDetail("");
    },
  });

  const name = profile.firstName?.trim() || "This member";
  const tooLong = Array.from(detail.trim()).length > limits.reportDetail.max;
  const close = () => {
    setOpen(false);
    send.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason && !tooLong && !send.isPending) send.mutate();
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
      >
        <Flag size={14} aria-hidden="true" />
        Report<span className="sr-only"> this profile</span>
      </button>
      <p className="t-small text-fg-2" role="status">
        {sent ? "Thank you. An administrator will review your report." : ""}
      </p>

      <Modal open={open} onClose={close} title="Report this profile">
        {/* The shared modal grows with its content; capping the form and
            scrolling its fields keeps the title and the buttons on a short
            phone screen. */}
        <form onSubmit={submit} noValidate className="flex max-h-[calc(100dvh-9rem)] flex-col">
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            <p>
              Tell an administrator what is wrong. {name} will not see who reported them, and nothing about the profile changes
              until an administrator looks at it.
            </p>
            <div className="mt-5">
              <fieldset className="pn-fieldset">
                <legend className="t-small">What is wrong?</legend>
                {/* Two columns where there is room; one on a phone (pn-options-2 collapses). */}
                <div className="pn-options pn-options-2">
                  {reportReasonOptions.map((option) => (
                    <Option
                      key={option.id}
                      name={`report-reason-${profile.id}`}
                      checked={reason === option.id}
                      title={option.label}
                      onClick={() => setReason(option.id)}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="field mt-5">
              <label className="field-label pn-field-label t-small" htmlFor={`report-detail-${profile.id}`}>
                <span>
                  Anything an administrator should know <span className="text-fg-2">(optional)</span>
                </span>
              </label>
              <Textarea
                id={`report-detail-${profile.id}`}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={4}
                aria-describedby={`report-detail-count-${profile.id}`}
                aria-invalid={tooLong || undefined}
              />
              <p className="pn-field-hint" id={`report-detail-count-${profile.id}`}>
                <CharCount value={detail} max={limits.reportDetail.max} />
              </p>
            </div>
            {send.isError ? (
              <div role="alert" className="mt-4">
                <Notice tone="warn">{reportErrorText(send.error)}</Notice>
              </div>
            ) : null}
          </div>
          <div className="pn-modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-solid btn-sm" disabled={!reason || tooLong || send.isPending}>
              {send.isPending ? "Sending" : "Send report"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** What `Profile` passes to `ProfileActions` as `reportSlot`. */
export const reportSlot: ProfileSlot = (profile) => <ReportControl profile={profile} />;
