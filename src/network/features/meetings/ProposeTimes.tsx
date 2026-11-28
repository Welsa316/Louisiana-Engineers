/**
 * "Propose times" (Task 31): up to three date and time pickers and one
 * length, read as Louisiana time, sent as one proposal. A new proposal
 * replaces the caller's own open one; the other party's stays. A dialog on
 * wider screens, a bottom sheet on phones.
 */

import { useState, type FormEvent } from "react";
import { fieldLimits } from "@shared/limits";
import { fmtDuration, louisianaDateAfter, louisianaToIso } from "@shared/meeting-time";
import { Field, Modal, Select, Sheet } from "../../ui/ui";
import { TimeRows, newTimeRow, type TimeRow } from "../../ui/meetings-times";
import { usePhone } from "../mentor/RequestDrawer";
import { meetingErrorText, useProposeTimes } from "./api";

const LENGTHS = [30, 45, 60, 90, 120] as const;
const DEFAULT_LENGTH = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Checked {
  errors: Record<string, string>;
  starts: string[];
}

/** Each row as an instant, or the reason it cannot be sent. */
function check(rows: TimeRow[], now: number): Checked {
  const errors: Record<string, string> = {};
  const starts: string[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row.date || !row.time) {
      errors[row.key] = "Choose a date and a start time.";
      continue;
    }
    const iso = louisianaToIso(row.date, row.time);
    if (!iso) {
      errors[row.key] = "That time does not exist in Louisiana: the clocks change that night. Choose another.";
      continue;
    }
    const at = Date.parse(iso);
    if (at <= now) {
      errors[row.key] = "Pick a time in the future.";
    } else if (at > now + fieldLimits.slotDaysAhead.max * DAY_MS) {
      errors[row.key] = "Pick a time within the next year.";
    } else if (seen.has(at)) {
      errors[row.key] = "This is the same as another time. Change one of them.";
    } else {
      seen.add(at);
      starts.push(iso);
    }
  }
  return { errors, starts };
}

export function ProposeTimesDialog({
  open,
  onClose,
  requestId,
  first,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  /** The other party's first name. */
  first: string;
}) {
  const phone = usePhone();
  const propose = useProposeTimes(requestId);
  const Panel = phone ? Sheet : Modal;
  const close = () => {
    propose.reset();
    onClose();
  };
  return (
    <Panel
      open={open}
      onClose={close}
      title="Propose times to meet"
      footer={
        <>
          {/* The sheet has its own Close button in its head. */}
          {phone ? null : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Close
            </button>
          )}
          <button
            type="submit"
            form={`propose-${requestId}`}
            className="btn btn-solid btn-sm"
            disabled={propose.isPending}
            aria-busy={propose.isPending || undefined}
          >
            {propose.isPending ? "Sending" : "Send times"}
          </button>
        </>
      }
    >
      {open ? <ProposeForm requestId={requestId} first={first} propose={propose} onDone={close} /> : null}
    </Panel>
  );
}

function ProposeForm({
  requestId,
  first,
  propose,
  onDone,
}: {
  requestId: string;
  first: string;
  propose: ReturnType<typeof useProposeTimes>;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<TimeRow[]>(() => [newTimeRow()]);
  const [length, setLength] = useState<number>(DEFAULT_LENGTH);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const today = louisianaDateAfter(new Date(), 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (propose.isPending) return;
    const result = check(rows, Date.now());
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    propose.mutate(
      {
        slots: result.starts.map((startsAt) => ({
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + length * 60_000).toISOString(),
        })),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form id={`propose-${requestId}`} noValidate onSubmit={submit}>
      <p className="t-small text-fg-2">
        Up to three times. {first} chooses one, and you are both told. Times are in Louisiana time (Central).
      </p>
      <TimeRows
        rows={rows}
        onChange={(next) => {
          setRows(next);
          setErrors({});
        }}
        max={fieldLimits.slotsPerProposal.max}
        min={today}
        errors={errors}
      />
      <Field label="Length" className="mt-5">
        {(id) => (
          <Select id={id} value={String(length)} onChange={(e) => setLength(Number(e.currentTarget.value))}>
            {LENGTHS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {fmtDuration(minutes)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {propose.isError ? (
        <p className="t-small mt-4" role="alert">
          {meetingErrorText(propose.error)}
        </p>
      ) : null}
    </form>
  );
}
