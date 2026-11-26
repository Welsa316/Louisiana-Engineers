/**
 * Form controls the onboarding screens add on top of ui.tsx: a field and a
 * fieldset with a fixed id (so the error list at the top of a step can link
 * to them), the error list itself, a tag entry, multi-select chips and a
 * character counter. Styling lives in onboarding.css.
 */

import { forwardRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Chip, PrivacyMark } from "./ui";
import "./onboarding.css";

type Privacy = "public" | "members" | "private";

/** What a control inside `OnbField` spreads onto itself. */
export interface ControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

function describedBy(id: string, hint: boolean, error: boolean): string | undefined {
  const ids = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function FieldHead({
  label,
  optional,
  privacy,
}: {
  label: ReactNode;
  optional?: boolean;
  privacy?: Privacy;
}) {
  return (
    <>
      <span>
        {label}
        {optional ? <span className="text-fg-2"> (optional)</span> : null}
      </span>
      {privacy ? <PrivacyMark level={privacy} /> : null}
    </>
  );
}

function FieldFoot({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {error ? (
        <p id={`${id}-error`} className="field-error t-small">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={`${id}-hint`} className="pn-field-hint">
          {hint}
        </div>
      ) : null}
    </>
  );
}

/** A labelled single control. The label marks optional fields in text and shows who sees the value. */
export function OnbField({
  id,
  label,
  hint,
  error,
  privacy,
  optional,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  privacy?: Privacy;
  optional?: boolean;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        <FieldHead label={label} optional={optional} privacy={privacy} />
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy(id, Boolean(hint), Boolean(error)),
      })}
      <FieldFoot id={id} hint={hint} error={error} />
    </div>
  );
}

/** A group of choices (option cards, chips). Its id lets an error link move focus to the first choice. */
export function OnbFieldset({
  id,
  legend,
  hint,
  error,
  privacy,
  optional,
  className,
  children,
}: {
  id: string;
  legend: string;
  hint?: ReactNode;
  error?: string;
  privacy?: Privacy;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={id}
      className={["pn-fieldset", className].filter(Boolean).join(" ")}
      aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
      aria-invalid={error ? true : undefined}
    >
      <legend className="t-small onb-legend">
        <FieldHead label={legend} optional={optional} privacy={privacy} />
      </legend>
      {children}
      <FieldFoot id={id} hint={hint} error={error} />
    </fieldset>
  );
}

/** Moves focus to the control for a field id: the element itself, or the first control inside it. */
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const target =
    el.matches("input, select, textarea, button")
      ? el
      : el.querySelector<HTMLElement>("input:not([disabled]), select, textarea, button:not([disabled])");
  (target ?? el).focus();
  el.scrollIntoView({ block: "center" });
}

/**
 * The problems on this step, listed at the top with a link to each field
 * (03 section 13). Announced when it appears; the caller moves focus to it.
 */
export const ErrorSummary = forwardRef<
  HTMLDivElement,
  { issues: { id: string; label: string; message: string }[]; title?: string }
>(function ErrorSummary({ issues, title }, ref) {
  if (issues.length === 0) return null;
  const heading =
    title ?? (issues.length === 1 ? "One thing to fix before you continue" : `${issues.length} things to fix before you continue`);
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="onb-errors" aria-labelledby="onb-errors-title">
      <h2 id="onb-errors-title">{heading}</h2>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.id}-${index}`}>
            <a
              href={`#${issue.id}`}
              onClick={(event) => {
                event.preventDefault();
                focusField(issue.id);
              }}
            >
              {issue.label}: {issue.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** "84 of 120 to 1200 characters": counts the way the server does (code points, trimmed). */
export function CharCount({ value, min, max }: { value: string; min: number; max: number }) {
  const n = Array.from(value.trim()).length;
  let text: string;
  if (min > 0 && n < min) text = `${n} characters, ${min} minimum`;
  else text = `${n} of ${max} characters`;
  return (
    <span className="pn-counter block" data-over={n > max || undefined}>
      {text}
    </span>
  );
}

/**
 * Free-text tags: type one and press Enter (or comma), or use Add. Leaving
 * the field keeps what was typed. Each tag has its own Remove button.
 */
export function TagInput({
  id,
  values,
  onChange,
  max,
  placeholder,
  invalid,
  describedBy: describedByIds,
  itemLabel,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Names one tag for the Remove button, for example "area of expertise". */
  itemLabel: string;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const full = values.length >= max;

  function commit(): void {
    const parts = text
      .split(",")
      .map((p) => p.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (parts.length === 0) {
      setText("");
      return;
    }
    const next = [...values];
    let skipped = false;
    for (const part of parts) {
      if (next.some((v) => v.toLowerCase() === part.toLowerCase())) continue;
      if (next.length >= max) {
        skipped = true;
        break;
      }
      next.push(part);
    }
    setNote(skipped ? `You can add up to ${max}.` : null);
    setText("");
    if (next.length !== values.length) onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
  }

  return (
    <div className="onb-tags">
      <div className="onb-tags-entry">
        <input
          id={id}
          className="field-input"
          value={text}
          placeholder={full ? `Up to ${max}; remove one to add another` : placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByIds}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          enterKeyHint="done"
          autoComplete="off"
        />
        <button type="button" className="btn btn-outline onb-tags-add" onClick={commit} disabled={!text.trim()}>
          <Plus size={16} aria-hidden="true" />
          Add
        </button>
      </div>
      {note ? <p className="pn-field-hint">{note}</p> : null}
      {values.length > 0 ? (
        <ul className="pn-chips mt-3" aria-label={`Added, ${values.length} of ${max}`}>
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                className="pn-chip onb-tag"
                aria-label={`Remove ${itemLabel} ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                {value}
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Multi-select chips over a vocabulary (topics, audiences). */
export function ChipChoices<T extends string>({
  options,
  values,
  onChange,
  max,
}: {
  options: readonly { id: T; label: string }[];
  values: T[];
  onChange: (next: T[]) => void;
  max?: number;
}) {
  const full = max !== undefined && values.length >= max;
  return (
    <div className="pn-chips">
      {options.map((option) => {
        const pressed = values.includes(option.id);
        return (
          <Chip
            key={option.id}
            pressed={pressed}
            aria-disabled={!pressed && full ? true : undefined}
            onClick={() => {
              if (pressed) onChange(values.filter((v) => v !== option.id));
              else if (!full) onChange([...values, option.id]);
            }}
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
  );
}
