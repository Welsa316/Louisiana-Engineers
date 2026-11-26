/**
 * Controls the settings area adds (Task 16): the section list, a field that
 * carries its own error and is reachable from the error summary, the summary
 * itself (03 section 13: errors are announced and listed with links to the
 * fields), a tag input for expertise and interests, and the save row. They
 * reuse the shared field, chip and button styles; the few rules they add
 * live in settings.css.
 */

import { useCallback, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { NavLink } from "react-router";
import { Input, PrivacyMark } from "./ui";
import "./settings.css";

/* ---------- Section list ---------- */

export interface SettingsSection {
  to: string;
  label: string;
  /** One line under the label on the phone's list of sections. */
  note: string;
}

/**
 * Links between the settings screens. Beside the content on a wide screen;
 * on a phone it is the list a member picks from, shown only on `/settings`
 * itself (settings.css).
 */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  return (
    <nav className="pn-settings-nav" aria-label="Settings sections">
      <ul>
        {sections.map((s) => (
          <li key={s.to}>
            <NavLink to={s.to} className="pn-settings-link">
              <span className="pn-settings-link-text">
                <span className="pn-settings-link-label">{s.label}</span>
                <span className="pn-settings-link-note">{s.note}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="pn-settings-link-chevron" />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ---------- Errors ---------- */

export interface FormIssue {
  path: readonly (string | number)[];
  message: string;
}

export type FieldErrors = Record<string, string>;

/** The DOM id of the control for a field key, so the summary can move focus to it. */
export function fieldId(form: string, key: string): string {
  return `${form}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Field errors keyed by the issue path (`education.1.year`), first message
 * per field. `known` lists the keys that have a control; an issue whose full
 * path has none falls back to its first segment (`education`).
 */
export function issuesToErrors(issues: readonly FormIssue[], known: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const full = issue.path.join(".");
    const key = known.includes(full) ? full : known.includes(String(issue.path[0] ?? "")) ? String(issue.path[0]) : "";
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

/** Field errors, plus a way to clear one as the member fixes it. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const clear = useCallback((key: string) => {
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);
  return { errors, setErrors, clear };
}

/**
 * The list of what stopped a save, announced when it appears, each item a
 * link that moves focus to its field. `general` holds errors with no field
 * (a refusal from the server).
 */
export function ErrorSummary({
  form,
  errors,
  labels,
  general,
}: {
  form: string;
  errors: FieldErrors;
  labels: Record<string, string>;
  general?: string | null;
}) {
  const entries = Object.entries(errors);
  if (entries.length === 0 && !general) return null;
  return (
    <div className="pn-settings-errors" role="alert">
      <p className="pn-settings-errors-title">
        {entries.length > 0 ? "Fix these to save your changes:" : "Your changes were not saved."}
      </p>
      <ul>
        {general ? <li>{general}</li> : null}
        {entries.map(([key, message]) => {
          const label = labels[key];
          if (!key || !label) return <li key={key || "form"}>{message}</li>;
          const id = fieldId(form, key);
          return (
            <li key={key}>
              <a
                href={`#${id}`}
                className="link"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(id)?.focus();
                }}
              >
                {label}
              </a>
              : {message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Fields ---------- */

type Privacy = "public" | "members" | "private";

/**
 * A labelled field whose control id is stable (`fieldId(form, name)`), so
 * the error summary can reach it, with its hint and error tied to the
 * control through `aria-describedby`.
 */
export function SettingsField({
  form,
  name,
  label,
  hint,
  privacy,
  optional = false,
  error,
  className,
  children,
}: {
  form: string;
  name: string;
  label: string;
  hint?: ReactNode;
  privacy?: Privacy;
  optional?: boolean;
  error?: string;
  className?: string;
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = fieldId(form, name);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        <span>
          {label}
          {optional && <span className="text-fg-2"> (optional)</span>}
        </span>
        {privacy && <PrivacyMark level={privacy} />}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errorId} className="field-error t-small">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="pn-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** "412 of 1200 characters", counted the way the server counts (code points). */
export function CharCount({ value, min, max }: { value: string; min?: number; max: number }) {
  const n = Array.from(value.trim()).length;
  const short = min !== undefined && n > 0 && n < min;
  return (
    <span className="pn-settings-count" data-over={n > max || short || undefined}>
      {n} of {max} characters{min ? `, at least ${min}` : ""}
    </span>
  );
}

/**
 * A list of short labels typed one at a time: Enter or a comma adds what is
 * typed, each chip removes itself. Duplicates (ignoring case) are skipped.
 */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  max,
  describedBy,
  invalid,
  removeLabel,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max: number;
  describedBy?: string;
  invalid?: boolean;
  /** "Remove Hydraulic modeling" */
  removeLabel: (value: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim().replace(/,+$/, "").trim();
    setDraft("");
    if (!value || values.length >= max) return;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };
  return (
    <>
      <Input
        id={id}
        value={draft}
        placeholder={values.length >= max ? `That is the most you can add (${max})` : placeholder}
        disabled={values.length >= max}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
      {values.length > 0 ? (
        <ul className="pn-chips mt-3" aria-label="Added">
          {values.map((v) => (
            <li key={v}>
              <button
                type="button"
                className="pn-chip pn-chip-added"
                aria-label={removeLabel(v)}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                {v}
                <span className="pn-chip-remove" aria-hidden="true">
                  <X size={12} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/* ---------- Save row ---------- */

/** The primary save, an undo, and room for the result line. */
export function SaveRow({
  label,
  pending,
  dirty,
  onUndo,
}: {
  label: string;
  pending: boolean;
  dirty: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="pn-settings-save">
      <button type="submit" className="btn btn-solid" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Saving" : label}
      </button>
      <button type="button" className="btn btn-ghost" disabled={!dirty || pending} onClick={onUndo}>
        Undo changes
      </button>
      {dirty && !pending ? <span className="t-small text-fg-2">You have unsaved changes.</span> : null}
    </div>
  );
}
