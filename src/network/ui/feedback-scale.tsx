/**
 * The helpfulness question of the feedback form (Task 32): five labelled
 * radios in one row, so the scale reads left to right on a phone and on a
 * desktop alike. Real radio inputs carry the semantics; the labels carry the
 * look.
 */

import { useId } from "react";
import "./feedback.css";

/** What each point of the scale means, as the form and the summary say it. */
export const HELPFUL_LABELS: Record<number, string> = {
  1: "Not helpful",
  2: "A little",
  3: "Fairly",
  4: "Helpful",
  5: "Very helpful",
};

export function HelpfulScale({
  legend,
  value,
  onChange,
  error,
}: {
  legend: string;
  value: number | null;
  onChange: (value: number) => void;
  /** Shown under the scale and announced with it. */
  error?: string | null;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset className="pn-scale" aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined}>
      <legend className="pn-field-label t-small">{legend}</legend>
      <div className="pn-scale-options">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="pn-scale-option" data-checked={value === n}>
            <input
              type="radio"
              name={name}
              value={n}
              className="sr-only"
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span className="pn-scale-num" aria-hidden="true">
              {n}
            </span>
            <span className="pn-scale-word">
              <span className="sr-only">{n}, </span>
              {HELPFUL_LABELS[n]}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="field-error t-small">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
