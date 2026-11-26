/**
 * Settings, Mentorship (03 section 7.4, ported from the prototype's
 * availability screen): status off, taking requests or paused with an
 * optional resume date; topics, audiences, format, mode, availability text,
 * session length and the most active mentees at once. A live line says what
 * the profile will show. The status goes through `set_mentorship_status` on
 * the server after the offer fields, in the same transaction, so a refused
 * status leaves the whole save undone.
 *
 * Lowering the cap or turning mentorship off keeps every relationship that
 * is already accepted; it only stops new requests.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { fieldLimits, limits } from "@shared/limits";
import { settingsPatchSchema, type MentorshipPatch } from "@shared/schemas/settings";
import { audiences, mentorshipTopics, type AudienceId } from "@shared/taxonomy";
import type { MeetingMode, MentoringFormat, MentorStatus } from "@shared/types/common";
import type { OwnProfile, OwnSettings } from "@shared/types/me";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { ErrorSummary, SaveRow, SettingsField, fieldId, issuesToErrors, useFieldErrors } from "../../ui/settings-controls";
import { Card, Chip, Input, Notice, Option, PageHead, Select, Status, Toast, UiLink } from "../../ui/ui";
import { settingsErrorText, useOwnProfile, useOwnSettings, useSaveSettings } from "./api";

const FORM = "mentorship";

type Mentorship = NonNullable<OwnSettings["mentorship"]>;

interface Draft {
  status: MentorStatus;
  resumeOn: string;
  topics: string[];
  audience: AudienceId[];
  format: MentoringFormat;
  mode: MeetingMode;
  availabilityText: string;
  durationMin: 30 | 45 | 60;
  maxActive: string;
}

function toDraft(m: Mentorship): Draft {
  return {
    status: m.status,
    resumeOn: m.status === "paused" ? (m.pausedUntil ?? "") : "",
    topics: [...m.topics].sort(),
    audience: audiences.map((a) => a.id).filter((id) => m.audience.includes(id)),
    format: m.format,
    mode: m.mode,
    availabilityText: m.availability ?? "",
    durationMin: m.durationMin,
    maxActive: String(m.maxActive),
  };
}

const LABELS: Record<string, string> = {
  "mentorship.status": "Status",
  "mentorship.resumeOn": "Resume on",
  "mentorship.topics": "Topics",
  "mentorship.audience": "Audience",
  "mentorship.format": "Format",
  "mentorship.mode": "Where",
  "mentorship.availabilityText": "General availability",
  "mentorship.durationMin": "Usual meeting length",
  "mentorship.maxActive": "Active mentees at once",
};
const KNOWN = Object.keys(LABELS);

/** Today and tomorrow as the date input writes them, in the member's own time zone. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "January 15", from a calendar date, without a time zone shifting the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const STATUS_SHORT: Record<MentorStatus, string> = { active: "Taking requests", paused: "Paused", off: "Off" };

/** What the profile says for a status (03 section 11.2). */
function profileLine(status: MentorStatus, resumeOn: string): string {
  if (status === "active") return "Taking requests";
  if (status === "paused") {
    return resumeOn ? `Not taking new requests right now, until ${longDate(resumeOn)}` : "Not taking new requests right now";
  }
  return "Mentorship off";
}

export function MentorshipSettings() {
  useMeta({ title: "Mentorship settings" });
  const profile = useOwnProfile();
  const settings = useOwnSettings();
  const error = profile.error ?? settings.error;

  return (
    <>
      <PageHead
        kicker="Mentorship"
        title="Your time, your rules."
        lead="Changes apply as soon as you save. Nothing here affects mentees you have already accepted."
      />
      {error ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{settingsErrorText(error)}</Notice>
        </div>
      ) : !profile.data || !settings.data ? (
        <p className="mt-8 t-small text-fg-2">Loading your settings</p>
      ) : profile.data.kind === "professional" && settings.data.mentorship ? (
        <MentorshipForm profile={profile.data} mentorship={settings.data.mentorship} />
      ) : (
        <div className="mt-8 max-w-2xl">
          <Notice tone="info" icon={<Info size={16} aria-hidden="true" />}>
            <p>Mentorship is offered by professionals.</p>
            <p className="mt-2">
              As a student you can find a mentor in the{" "}
              <UiLink to="/me/discover" className="link">
                list of mentors
              </UiLink>
              . If you now work in the field, you can switch to a professional profile under{" "}
              <UiLink to="/settings/profile" className="link">
                Profile
              </UiLink>
              .
            </p>
          </Notice>
        </div>
      )}
    </>
  );
}

function MentorshipForm({ profile, mentorship }: { profile: OwnProfile; mentorship: Mentorship }) {
  const stored = JSON.stringify(toDraft(mentorship));
  const [saved, setSaved] = useState(() => toDraft(mentorship));
  const [draft, setDraft] = useState(saved);
  const { errors, setErrors, clear } = useFieldErrors();
  const [general, setGeneral] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const save = useSaveSettings();
  const offersMentoring = profile.professional?.participation.includes("mentoring") ?? false;

  useEffect(() => {
    const next = JSON.parse(stored) as Draft;
    setSaved(next);
    setDraft(next);
  }, [stored]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clear(`mentorship.${key}`);
    setFlash(null);
    setGeneral(null);
  };
  const toggle = <T extends string>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFlash(null);
    setGeneral(null);
    const patch: Record<string, unknown> = {};
    if (!same(saved.topics, draft.topics)) patch.topics = draft.topics;
    if (!same(saved.audience, draft.audience)) patch.audience = draft.audience;
    if (saved.format !== draft.format) patch.format = draft.format;
    if (saved.mode !== draft.mode) patch.mode = draft.mode;
    if (saved.availabilityText.trim() !== draft.availabilityText.trim()) patch.availabilityText = draft.availabilityText;
    if (saved.durationMin !== draft.durationMin) patch.durationMin = draft.durationMin;
    if (saved.maxActive.trim() !== draft.maxActive.trim()) {
      patch.maxActive = /^\s*\d+\s*$/.test(draft.maxActive) ? Number(draft.maxActive) : Number.NaN;
    }
    // The status and its resume date travel together; a new date alone resends "paused".
    if (saved.status !== draft.status || (draft.status === "paused" && saved.resumeOn !== draft.resumeOn)) {
      patch.status = draft.status;
      if (draft.status === "paused") patch.resumeOn = draft.resumeOn || null;
    }
    if (Object.keys(patch).length === 0) {
      setErrors({});
      setGeneral("Nothing has changed.");
      return;
    }

    const next: Record<string, string> = {};
    const parsed = settingsPatchSchema.safeParse({ mentorship: patch });
    if (!parsed.success) {
      Object.assign(
        next,
        issuesToErrors(
          parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.path[1] === "maxActive" && /Expected number|nan/i.test(i.message) ? "Enter a whole number" : i.message,
          })),
          KNOWN,
        ),
      );
    }
    if (draft.status === "paused" && draft.resumeOn && draft.resumeOn <= isoDay(0) && !next["mentorship.resumeOn"]) {
      next["mentorship.resumeOn"] = "Choose a date after today, or leave it empty";
    }
    if (draft.status === "active" && draft.topics.length === 0 && !next["mentorship.topics"]) {
      next["mentorship.topics"] = "Choose at least one topic";
    }
    if (draft.status === "active" && draft.audience.length === 0 && !next["mentorship.audience"]) {
      next["mentorship.audience"] = "Choose at least one audience";
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(
      { mentorship: patch as MentorshipPatch },
      {
        onSuccess: () => setFlash("Mentorship settings saved."),
        onError: (error) => {
          if (isApiError(error, "validation") && error.issues.length > 0) setErrors(issuesToErrors(error.issues, KNOWN));
          else setGeneral(settingsErrorText(error));
        },
      },
    );
  };

  const undo = () => {
    setDraft(saved);
    setErrors({});
    setGeneral(null);
  };

  const savedTone = saved.status === "active" ? "active" : saved.status === "paused" ? "paused" : "off";
  const knownTopics = new Set(mentorshipTopics.map((t) => t.id));
  const topics = [...mentorshipTopics, ...draft.topics.filter((t) => !knownTopics.has(t)).map((id) => ({ id, label: id }))];

  return (
    <>
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      <form className="pn-split mt-8" noValidate onSubmit={submit}>
        <div className="grid grid-cols-1 gap-6 min-w-0">
          <ErrorSummary form={FORM} errors={errors} labels={LABELS} general={general} />

          {!offersMentoring ? (
            <Notice tone="warn" icon={<Info size={16} aria-hidden="true" />}>
              Mentorship is not one of the ways you take part, so it stays off. Turn on Mentorship under{" "}
              <UiLink to="/settings/profile" className="link">
                Profile, How you take part
              </UiLink>{" "}
              to offer it.
            </Notice>
          ) : null}
          {profile.adminHidden ? (
            <Notice tone="warn">An administrator has hidden your profile, so mentorship stays off until they restore it.</Notice>
          ) : null}

          <Card title="Status" aside={<Status tone={savedTone} label={STATUS_SHORT[saved.status]} />}>
            <p className="t-small text-fg-2 mb-4">Your profile shows: {profileLine(saved.status, saved.resumeOn)}</p>
            <div className="pn-options" role="radiogroup" aria-label="Mentorship status" id={fieldId(FORM, "mentorship.status")}>
              <Option
                name="mentor-status"
                checked={draft.status === "active"}
                title="Taking requests"
                note="Students and early-career members who match your topics and audience can send you a request."
                onClick={() => set("status", "active")}
              />
              <Option
                name="mentor-status"
                checked={draft.status === "paused"}
                title="Paused"
                note="Your profile stays listed and says you are not taking new requests. Set a date to switch back on automatically, or leave it open."
                onClick={() => set("status", "paused")}
              />
              <Option
                name="mentor-status"
                checked={draft.status === "off"}
                title="Off"
                note="Your profile no longer offers mentorship. Mentees you already accepted keep working with you."
                onClick={() => set("status", "off")}
              />
            </div>
            {draft.status === "paused" ? (
              <div className="mt-4 max-w-xs">
                <SettingsField
                  form={FORM}
                  name="mentorship.resumeOn"
                  label="Resume on"
                  optional
                  hint="We switch you back on that morning and let you know."
                  error={errors["mentorship.resumeOn"]}
                >
                  {(c) => (
                    <Input {...c} type="date" min={isoDay(1)} value={draft.resumeOn} onChange={(e) => set("resumeOn", e.target.value)} />
                  )}
                </SettingsField>
              </div>
            ) : null}
            {draft.status !== saved.status || draft.resumeOn !== saved.resumeOn ? (
              <p className="pn-settings-live t-small" aria-live="polite">
                Your profile will show: {profileLine(draft.status, draft.status === "paused" ? draft.resumeOn : "")}
              </p>
            ) : null}
          </Card>

          <Card title="Capacity">
            <div className="pn-form pn-form-2">
              <SettingsField
                form={FORM}
                name="mentorship.maxActive"
                label="Active mentees at once"
                privacy="private"
                hint={`Between ${limits.maxActive.min} and ${limits.maxActive.max}. Lowering it never ends a relationship; it only stops new accepts.`}
                error={errors["mentorship.maxActive"]}
              >
                {(c) => (
                  <Input
                    {...c}
                    type="number"
                    inputMode="numeric"
                    min={limits.maxActive.min}
                    max={limits.maxActive.max}
                    step={1}
                    value={draft.maxActive}
                    onChange={(e) => set("maxActive", e.target.value)}
                  />
                )}
              </SettingsField>
              <SettingsField form={FORM} name="mentorship.durationMin" label="Usual meeting length" privacy="public" error={errors["mentorship.durationMin"]}>
                {(c) => (
                  <Select
                    {...c}
                    value={String(draft.durationMin)}
                    onChange={(e) => set("durationMin", Number(e.target.value) as Draft["durationMin"])}
                  >
                    {fieldLimits.durationMin.map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </Select>
                )}
              </SettingsField>
              <SettingsField
                form={FORM}
                name="mentorship.availabilityText"
                label="General availability"
                optional
                privacy="public"
                className="pn-form-span"
                hint={`Shown on your profile, up to ${limits.availabilityText.max} characters. This is not a calendar.`}
                error={errors["mentorship.availabilityText"]}
              >
                {(c) => (
                  <Input
                    {...c}
                    placeholder="Weekday evenings, some Saturday mornings"
                    value={draft.availabilityText}
                    onChange={(e) => set("availabilityText", e.target.value)}
                  />
                )}
              </SettingsField>
            </div>
          </Card>

          <Card title="What you offer">
            <div className="pn-form">
              <fieldset className="pn-fieldset">
                <legend className="t-small" id={fieldId(FORM, "mentorship.topics")} tabIndex={-1}>
                  Topics (at least {fieldLimits.mentorTopics.min})
                </legend>
                <div className="pn-chips">
                  {topics.map((t) => (
                    <Chip key={t.id} pressed={draft.topics.includes(t.id)} onClick={() => set("topics", toggle(draft.topics, t.id).sort())}>
                      {t.label}
                    </Chip>
                  ))}
                </div>
                {errors["mentorship.topics"] ? <p className="field-error t-small">{errors["mentorship.topics"]}</p> : null}
              </fieldset>
              <fieldset className="pn-fieldset">
                <legend className="t-small" id={fieldId(FORM, "mentorship.audience")} tabIndex={-1}>
                  Audience (at least {fieldLimits.mentorAudience.min})
                </legend>
                <div className="pn-chips">
                  {audiences.map((a) => (
                    <Chip
                      key={a.id}
                      pressed={draft.audience.includes(a.id)}
                      onClick={() =>
                        set(
                          "audience",
                          audiences.map((x) => x.id).filter((id) => (id === a.id ? !draft.audience.includes(id) : draft.audience.includes(id))),
                        )
                      }
                    >
                      {a.label}
                    </Chip>
                  ))}
                </div>
                {errors["mentorship.audience"] ? <p className="field-error t-small">{errors["mentorship.audience"]}</p> : null}
              </fieldset>
              <div className="pn-form pn-form-2">
                <SettingsField form={FORM} name="mentorship.format" label="Format" privacy="public" error={errors["mentorship.format"]}>
                  {(c) => (
                    <Select {...c} value={draft.format} onChange={(e) => set("format", e.target.value as MentoringFormat)}>
                      <option value="one-time">One-time guidance</option>
                      <option value="recurring">Recurring mentoring</option>
                      <option value="either">Either</option>
                    </Select>
                  )}
                </SettingsField>
                <SettingsField form={FORM} name="mentorship.mode" label="Where" privacy="public" error={errors["mentorship.mode"]}>
                  {(c) => (
                    <Select {...c} value={draft.mode} onChange={(e) => set("mode", e.target.value as MeetingMode)}>
                      <option value="online">Online</option>
                      <option value="in-person">In person</option>
                      <option value="either">Either</option>
                    </Select>
                  )}
                </SettingsField>
              </div>
            </div>
          </Card>

          <SaveRow label="Save mentorship" pending={save.isPending} dirty={dirty} onUndo={undo} />
        </div>

        <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="How this shows up">
          <Card title="How this shows up" lift>
            <ul className="grid gap-3 t-small text-fg-2">
              <li>
                <span className="text-fg">Paused</span>: your profile stays listed and the request button says you are not
                taking new requests, with your resume date if you set one.
              </li>
              <li>
                <span className="text-fg">Full</span>: shown on its own when your accepted mentees reach your limit. It clears
                when you mark one completed.
              </li>
              <li>
                <span className="text-fg">Topics and audience</span>: members outside them cannot choose you in the request
                form.
              </li>
            </ul>
          </Card>
          <Card title="Who sees the limit">
            <p className="t-small text-fg-2">
              Only you. Others see whether you are taking requests, never how many mentees you have or allow.
            </p>
          </Card>
        </aside>
      </form>
    </>
  );
}

const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
