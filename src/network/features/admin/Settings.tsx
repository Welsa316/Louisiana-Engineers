/**
 * Platform settings: the `config` table (02 section 4.3). Only the changed
 * keys are sent, in one `PATCH /api/admin/config`; the server checks each
 * against its range with `admin_update_config` and records the change in the
 * audit log, so a refusal leaves every value as it was.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { configLimits } from "@shared/limits";
import { configPatchSchema } from "@shared/schemas/admin";
import type { AdminConfig } from "@shared/types/admin";
import { useMeta } from "../../lib/meta";
import { Card, Input, Notice, PageHead, SwitchRow, Toast } from "../../ui/ui";
import { adminErrorText, useAdminAction, useAdminConfig } from "./api";

type NumberKey = Exclude<keyof AdminConfig, "platform_paused" | "reminder_days">;

const NUMBER_FIELDS: { key: NumberKey; label: string; unit: string; hint: string }[] = [
  {
    key: "request_expiry_days",
    label: "Requests expire after",
    unit: "days",
    hint: "A request with no reply closes as No reply after this many days.",
  },
  { key: "pending_cap", label: "Open requests per mentee", unit: "requests", hint: "How many a mentee may have waiting at once." },
  {
    key: "default_max_active",
    label: "Default mentee limit",
    unit: "mentees",
    hint: "What a new mentor starts with; each mentor can change their own.",
  },
  { key: "daily_request_limit", label: "Requests per member per day", unit: "requests", hint: "A limit against misuse." },
  { key: "daily_report_limit", label: "Reports per member per day", unit: "reports", hint: "A limit against misuse." },
  {
    key: "magic_links_per_hour",
    label: "Sign-in links per hour",
    unit: "links",
    hint: "Per address and per network, so nobody can flood an inbox.",
  },
  {
    key: "retention_months",
    label: "Keep request messages for",
    unit: "months",
    hint: "After this, the free text of closed requests is emptied. Counts and the audit log stay.",
  },
];

interface Draft {
  platform_paused: boolean;
  numbers: Record<NumberKey, string>;
  reminders: [string, string];
}

function toDraft(c: AdminConfig): Draft {
  return {
    platform_paused: c.platform_paused,
    numbers: Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, String(c[f.key])])) as Record<NumberKey, string>,
    reminders: [String(c.reminder_days[0] ?? ""), String(c.reminder_days[1] ?? "")],
  };
}

/** Only what changed, as the patch the server takes (numbers left as typed so zod reports bad ones). */
function diff(saved: AdminConfig, draft: Draft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.platform_paused !== saved.platform_paused) patch.platform_paused = draft.platform_paused;
  for (const f of NUMBER_FIELDS) {
    const text = draft.numbers[f.key].trim();
    const value = text === "" ? Number.NaN : Number(text);
    if (value !== saved[f.key]) patch[f.key] = value;
  }
  const reminders = draft.reminders.map((r) => r.trim()).filter((r) => r !== "").map(Number);
  if (JSON.stringify(reminders) !== JSON.stringify(saved.reminder_days)) patch.reminder_days = reminders;
  return patch;
}

export function Settings() {
  useMeta({ title: "Platform settings" });
  const config = useAdminConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useAdminAction((patch: Record<string, unknown>) => ({ path: "/admin/config", method: "PATCH", body: patch }));

  useEffect(() => {
    if (config.data && !draft) setDraft(toDraft(config.data));
  }, [config.data, draft]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.data || !draft) return;
    setSaved(false);
    const patch = diff(config.data, draft);
    if (Object.keys(patch).length === 0) {
      setError("Nothing has changed.");
      return;
    }
    const parsed = configPatchSchema.safeParse(patch);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = NUMBER_FIELDS.find((f) => f.key === issue?.path[0]);
      setError(field ? `${field.label}: ${issue.message}` : (issue?.message ?? "Check the values and try again."));
      return;
    }
    setError(null);
    save.mutate(parsed.data, {
      onSuccess: (next) => {
        setDraft(toDraft(next as AdminConfig));
        setSaved(true);
      },
    });
  };

  return (
    <>
      <PageHead
        kicker="Settings"
        title="How the platform behaves."
        lead="These numbers apply to everyone. Every change is recorded in the audit log with the old and new value."
      />
      {saved ? (
        <div className="mt-6">
          <Toast text="Settings saved." />
        </div>
      ) : null}
      {config.isError ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{adminErrorText(config.error)}</Notice>
        </div>
      ) : !draft ? (
        <p className="mt-8 t-small text-fg-2">Loading settings</p>
      ) : (
        <form className="mt-8 grid grid-cols-1 gap-6 max-w-3xl" noValidate onSubmit={submit}>
          <Card title="Pause the platform">
            <SwitchRow
              title="Pause new requests and hide the directory"
              note="For an incident or a board decision. Signed-in members keep their history; the directory shows nothing and no request can be sent until this is off."
              checked={draft.platform_paused}
              onChange={(v) => setDraft({ ...draft, platform_paused: v })}
            />
          </Card>

          <Card title="Requests and limits">
            <div className="pn-form pn-form-2">
              {NUMBER_FIELDS.map((f) => (
                <NumberField
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  hint={`${f.hint} ${rangeText(f.key)}`}
                  value={draft.numbers[f.key]}
                  onChange={(v) => setDraft({ ...draft, numbers: { ...draft.numbers, [f.key]: v } })}
                />
              ))}
              <NumberField
                label="First reminder"
                unit="days"
                hint="Days after a request is sent that the mentor is reminded. Leave empty for none."
                value={draft.reminders[0]}
                onChange={(v) => setDraft({ ...draft, reminders: [v, draft.reminders[1]] })}
              />
              <NumberField
                label="Second reminder"
                unit="days"
                hint="Later than the first, and before the request expires. Leave empty for none."
                value={draft.reminders[1]}
                onChange={(v) => setDraft({ ...draft, reminders: [draft.reminders[0], v] })}
              />
            </div>
          </Card>

          {error ? (
            <div role="alert">
              <Notice tone="warn">{error}</Notice>
            </div>
          ) : null}
          {save.isError ? (
            <div role="alert">
              <Notice tone="warn">{adminErrorText(save.error)}</Notice>
            </div>
          ) : null}
          <div className="pn-admin-actions">
            <button type="submit" className="btn btn-solid" disabled={save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending ? "Saving" : "Save settings"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (config.data) setDraft(toDraft(config.data));
                setError(null);
              }}
            >
              Undo changes
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function rangeText(key: NumberKey): string {
  const range = configLimits[key];
  return `Between ${range.min} and ${range.max}.`;
}

function NumberField({
  label,
  unit,
  hint,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="field">
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        <span>
          {label} <span className="text-fg-2">({unit})</span>
        </span>
      </label>
      <Input
        id={id}
        className="field-input pn-admin-number"
        type="number"
        inputMode="numeric"
        step={1}
        value={value}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={hintId} className="pn-field-hint">
        {hint}
      </p>
    </div>
  );
}
