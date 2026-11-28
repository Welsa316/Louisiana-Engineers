/**
 * The date and time pickers for proposing times to meet (Task 31): one row
 * per time, up to `max`, each a native date input and a native time input
 * (so phones get their own wheels and calendars), read as Louisiana time.
 * The rows are controlled; the caller validates and sends them.
 */

import { Plus, X } from "lucide-react";
import "./meetings.css";

export interface TimeRow {
  /** Stable across edits, for React and for the inputs' ids. */
  key: string;
  /** `YYYY-MM-DD`, as the date input gives it. */
  date: string;
  /** `HH:MM` (24-hour), as the time input gives it. */
  time: string;
}

let next = 0;
export function newTimeRow(date = "", time = ""): TimeRow {
  next += 1;
  return { key: `time-${next}`, date, time };
}

export function TimeRows({
  rows,
  onChange,
  max,
  min,
  errors,
}: {
  rows: TimeRow[];
  onChange: (rows: TimeRow[]) => void;
  max: number;
  /** The earliest date the picker offers (`YYYY-MM-DD`). */
  min?: string;
  /** Per-row messages, by row key. */
  errors: Record<string, string>;
}) {
  const update = (key: string, patch: Partial<TimeRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="pn-time-rows">
      {rows.map((row, i) => {
        const error = errors[row.key];
        const errorId = `${row.key}-error`;
        return (
          <fieldset key={row.key} className="pn-fieldset pn-time-row" aria-describedby={error ? errorId : undefined}>
            <legend className="t-small">Time {i + 1}</legend>
            {rows.length > 1 ? (
              <button
                type="button"
                className="pn-icon-btn pn-time-row-remove"
                aria-label={`Remove time ${i + 1}`}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <X size={18} aria-hidden="true" />
              </button>
            ) : null}
            <div className="pn-time-row-fields">
              <div className="field">
                <label className="field-label pn-field-label t-small" htmlFor={`${row.key}-date`}>
                  Date
                </label>
                <input
                  id={`${row.key}-date`}
                  className="field-input"
                  type="date"
                  value={row.date}
                  min={min}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => update(row.key, { date: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label pn-field-label t-small" htmlFor={`${row.key}-time`}>
                  Start time
                </label>
                <input
                  id={`${row.key}-time`}
                  className="field-input"
                  type="time"
                  step={300}
                  value={row.time}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => update(row.key, { time: e.target.value })}
                />
              </div>
            </div>
            {error ? (
              <p id={errorId} className="pn-field-hint pn-time-row-error" role="alert">
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      {rows.length < max ? (
        <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => onChange([...rows, newTimeRow()])}>
          <Plus size={15} aria-hidden="true" />
          Add another time
        </button>
      ) : null}
    </div>
  );
}
