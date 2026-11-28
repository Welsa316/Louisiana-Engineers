/**
 * Settings, Profile: what the profile says (03 section 5 steps 2 and 3,
 * ported from the prototype's edit-profile screen). Professionals edit
 * their public profile and how they take part; students edit what a mentor
 * sees when they send a request. Only the changed fields are sent, in one
 * `PATCH /api/me/profile`, checked first with the shared schema.
 *
 * Also here: switching between a student and a professional profile
 * (`POST /api/me/kind`), which keeps saved profiles and requests.
 */

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { fieldLimits, limits } from "@shared/limits";
import { profilePatchSchema, type ProfilePatchInput } from "@shared/schemas/profile";
import {
  audiences,
  disciplineGroups,
  disciplines,
  participationOptions,
  type AudienceId,
  type ParticipationId,
} from "@shared/taxonomy";
import type { OwnProfile } from "@shared/types/me";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { useRegions, useTopics, withChosen, withChosenRegion } from "../../lib/vocabulary";
import {
  CharCount,
  ErrorSummary,
  SaveRow,
  SettingsField,
  TagInput,
  fieldId,
  issuesToErrors,
  useFieldErrors,
} from "../../ui/settings-controls";
import { Card, Chip, Input, Modal, Notice, Option, PageHead, Select, Status, Textarea, Toast, UiLink } from "../../ui/ui";
import { settingsErrorText, useOwnProfile, useSaveProfile, useSetKind } from "./api";

const FORM = "profile";

interface EducationDraft {
  degree: string;
  field: string;
  school: string;
  year: string;
}

interface Draft {
  firstName: string;
  lastName: string;
  credentials: string;
  location: string;
  region: string;
  bio: string;
  linkedinUrl: string;
  websiteUrl: string;
  interests: string[];
  // Professionals
  title: string;
  organization: string;
  disciplineId: string;
  yearsExperience: string;
  expertise: string[];
  education: EducationDraft[];
  participation: ParticipationId[];
  // Students
  program: string;
  level: AudienceId | "";
  institution: string;
  goals: string;
  topicsNeeded: string[];
}

function toDraft(p: OwnProfile): Draft {
  const pro = p.professional;
  const student = p.student;
  return {
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    credentials: p.credentials ?? "",
    location: p.location ?? "",
    region: p.region,
    bio: p.bio ?? "",
    linkedinUrl: p.linkedinUrl ?? "",
    websiteUrl: p.websiteUrl ?? "",
    interests: [...(pro?.interests ?? student?.interests ?? [])],
    title: pro?.title ?? "",
    organization: pro?.organization ?? "",
    disciplineId: pro?.disciplineId ?? "",
    yearsExperience: pro ? String(pro.yearsExperience) : "",
    expertise: pro ? pro.expertise.map((t) => t.label) : [],
    education: p.education.map((e) => ({ degree: e.degree, field: e.field, school: e.school, year: String(e.year) })),
    participation: [...(pro?.participation ?? [])],
    program: student?.program ?? "",
    level: student?.level ?? "",
    institution: student?.institution ?? "",
    goals: student?.goals ?? "",
    topicsNeeded: [...(student?.topicsNeeded ?? [])],
  };
}

const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

/** A whole number as typed, or NaN, so the schema reports anything else. */
const wholeNumber = (text: string) => (/^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN);

/**
 * Only what changed, as the patch the server takes. Text is compared
 * trimmed; an emptied optional field is sent as "" (the schema reads that
 * as "clear it").
 */
function diff(p: OwnProfile, saved: Draft, draft: Draft): ProfilePatchInput {
  const patch: Record<string, unknown> = {};
  const text = (key: keyof Draft) => {
    const before = String(saved[key]).trim();
    const after = String(draft[key]).trim();
    if (before !== after) patch[key] = after;
  };
  text("firstName");
  text("lastName");
  text("credentials");
  text("location");
  if (saved.region !== draft.region) patch.region = draft.region;
  text("bio");
  text("linkedinUrl");
  text("websiteUrl");
  if (!same(saved.interests, draft.interests)) patch.interests = draft.interests;

  if (p.kind === "professional") {
    // A details row that does not exist yet (after a switch) is written whole.
    const fresh = p.professional === null;
    if (fresh || saved.title.trim() !== draft.title.trim()) patch.title = draft.title.trim();
    if (fresh || saved.organization.trim() !== draft.organization.trim()) patch.organization = draft.organization.trim();
    if (fresh || saved.disciplineId !== draft.disciplineId) patch.disciplineId = draft.disciplineId;
    if (fresh || saved.yearsExperience.trim() !== draft.yearsExperience.trim()) {
      patch.yearsExperience = wholeNumber(draft.yearsExperience);
    }
    if (!same(saved.expertise, draft.expertise)) patch.expertise = draft.expertise;
    if (!same(saved.education, draft.education)) {
      patch.education = draft.education.map((e) => ({
        degree: e.degree,
        field: e.field,
        school: e.school,
        year: wholeNumber(e.year),
      }));
    }
    if (fresh || !same(saved.participation, draft.participation)) patch.participation = draft.participation;
  } else if (p.kind === "student") {
    const fresh = p.student === null;
    for (const key of ["program", "institution", "goals"] as const) {
      if (fresh || saved[key].trim() !== draft[key].trim()) patch[key] = draft[key].trim();
    }
    if (fresh || saved.level !== draft.level) patch.level = draft.level;
    if (fresh || !same(saved.topicsNeeded, draft.topicsNeeded)) patch.topicsNeeded = draft.topicsNeeded;
  }
  return patch as ProfilePatchInput;
}

const LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  credentials: "Credentials",
  location: "General location",
  region: "Region",
  bio: "Biography",
  linkedinUrl: "LinkedIn profile",
  websiteUrl: "Personal website",
  interests: "Professional interests",
  title: "Job title",
  organization: "Company or institution",
  disciplineId: "Discipline",
  yearsExperience: "Years of experience",
  expertise: "Expertise",
  education: "Education",
  participation: "Participation",
  program: "Program",
  level: "Level",
  institution: "Institution",
  goals: "What you are working toward",
  topicsNeeded: "Topics you want help with",
};

for (let i = 0; i < limits.education.max; i++) {
  LABELS[`education.${i}.degree`] = `Education ${i + 1}, degree`;
  LABELS[`education.${i}.field`] = `Education ${i + 1}, field`;
  LABELS[`education.${i}.school`] = `Education ${i + 1}, school`;
  LABELS[`education.${i}.year`] = `Education ${i + 1}, year`;
}
const KNOWN = Object.keys(LABELS);

const NUMBER_MESSAGE: Record<string, string> = {
  yearsExperience: "Enter a whole number of years",
};

/** Friendlier text for the schema's type errors on number fields. */
function issueMessage(path: readonly (string | number)[], message: string): string {
  if (/Expected number|nan/i.test(message)) {
    const key = String(path[0]);
    if (key === "education") return "Enter a four-digit year";
    return NUMBER_MESSAGE[key] ?? "Enter a whole number";
  }
  return message;
}

export function ProfileSettings({ metaTitle = "Profile" }: { metaTitle?: string }) {
  useMeta({ title: metaTitle });
  const profile = useOwnProfile();

  if (profile.isError) {
    return (
      <>
        <PageHead kicker="Profile" title="Your profile." />
        <div role="alert" className="mt-8">
          <Notice tone="warn">{settingsErrorText(profile.error)}</Notice>
        </div>
      </>
    );
  }
  if (!profile.data) {
    return (
      <>
        <PageHead kicker="Profile" title="Your profile." />
        <p className="mt-8 t-small text-fg-2">Loading your profile</p>
      </>
    );
  }
  return <ProfileForm profile={profile.data} />;
}

function ProfileForm({ profile }: { profile: OwnProfile }) {
  const professional = profile.kind === "professional";
  const [saved, setSaved] = useState(() => toDraft(profile));
  const [draft, setDraft] = useState(saved);
  const { errors, setErrors, clear } = useFieldErrors();
  const [general, setGeneral] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const save = useSaveProfile();

  // A save, or a switch of kind, answers a different profile: start again
  // from it. A re-read that changes nothing leaves the member's edits alone.
  const stored = JSON.stringify(toDraft(profile));
  useEffect(() => {
    const next = JSON.parse(stored) as Draft;
    setSaved(next);
    setDraft(next);
  }, [stored]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clear(key);
    setFlash(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFlash(null);
    setGeneral(null);
    const patch = diff(profile, saved, draft);
    if (Object.keys(patch).length === 0) {
      setErrors({});
      setGeneral("Nothing has changed.");
      return;
    }
    const parsed = profilePatchSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(
        issuesToErrors(
          parsed.error.issues.map((i) => ({ path: i.path, message: issueMessage(i.path, i.message) })),
          KNOWN,
        ),
      );
      return;
    }
    if (professional && draft.bio.trim() === "") {
      setErrors({ bio: "A professional profile needs a biography" });
      return;
    }
    setErrors({});
    save.mutate(patch, {
      onSuccess: () => setFlash("Profile saved."),
      onError: (error) => {
        if (isApiError(error, "validation") && error.issues.length > 0) {
          setErrors(issuesToErrors(error.issues, KNOWN));
        } else {
          setGeneral(settingsErrorText(error));
        }
      },
    });
  };

  const undo = () => {
    setDraft(saved);
    setErrors({});
    setGeneral(null);
  };

  const proposed = profile.professional?.expertise.filter((t) => t.status === "proposed").map((t) => t.label) ?? [];
  // A region choice only once the network serves more than one.
  const activeRegions = useRegions();
  const regions = activeRegions.length > 1 ? withChosenRegion(activeRegions, draft.region) : null;

  return (
    <>
      <PageHead
        kicker="Profile"
        title={professional ? "How you appear in the directory." : "What a mentor sees about you."}
        lead={
          professional
            ? "Changes go live as soon as you save. Changing your title or organization removes the verified mark until an administrator checks it again."
            : "Students are never listed. Mentors see this when you send them a request."
        }
        actions={
          professional && profile.approvalState === "approved" ? (
            <UiLink to={`/directory/${profile.id}`} className="btn btn-outline btn-sm">
              View your profile
              <ArrowUpRight size={14} aria-hidden="true" />
            </UiLink>
          ) : null
        }
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      <form className="pn-split mt-8" noValidate onSubmit={submit}>
        <div className="grid grid-cols-1 gap-6 min-w-0">
          <ErrorSummary form={FORM} errors={errors} labels={LABELS} general={general} />

          <Card title="About you">
            <div className="pn-form pn-form-2">
              <SettingsField form={FORM} name="firstName" label="First name" privacy={professional ? "public" : "private"} error={errors.firstName}>
                {(c) => <Input {...c} autoComplete="given-name" value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />}
              </SettingsField>
              <SettingsField form={FORM} name="lastName" label="Last name" privacy={professional ? "public" : "private"} error={errors.lastName}>
                {(c) => <Input {...c} autoComplete="family-name" value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />}
              </SettingsField>
              {professional ? (
                <SettingsField form={FORM} name="credentials" label="Credentials" optional privacy="public" hint="For example PE, PhD or MD." error={errors.credentials}>
                  {(c) => <Input {...c} value={draft.credentials} onChange={(e) => set("credentials", e.target.value)} />}
                </SettingsField>
              ) : null}
              <SettingsField
                form={FORM}
                name="location"
                label="General location"
                privacy={professional ? "public" : "private"}
                hint="City and state only, never an address."
                error={errors.location}
              >
                {(c) => <Input {...c} autoComplete="address-level2" value={draft.location} onChange={(e) => set("location", e.target.value)} />}
              </SettingsField>
              {regions ? (
                <SettingsField
                  form={FORM}
                  name="region"
                  label="Region"
                  privacy={professional ? "public" : "private"}
                  hint="The MEST region you live or work in. The directory can be filtered by it."
                  error={errors.region}
                >
                  {(c) => (
                    <Select {...c} value={draft.region} onChange={(e) => set("region", e.currentTarget.value)}>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </SettingsField>
              ) : null}
              <SettingsField
                form={FORM}
                name="bio"
                label="Biography"
                optional={!professional}
                privacy={professional ? "public" : "private"}
                className="pn-form-span"
                hint={<CharCount value={draft.bio} min={limits.bio.min} max={limits.bio.max} />}
                error={errors.bio}
              >
                {(c) => <Textarea {...c} value={draft.bio} onChange={(e) => set("bio", e.target.value)} />}
              </SettingsField>
            </div>
          </Card>

          {professional ? (
            <ProfessionalFields draft={draft} set={set} errors={errors} proposed={proposed} />
          ) : (
            <StudentFields draft={draft} set={set} errors={errors} />
          )}

          <Card title="Links">
            <div className="pn-form pn-form-2">
              <SettingsField
                form={FORM}
                name="linkedinUrl"
                label="LinkedIn profile"
                optional
                privacy="private"
                hint="Shown only if you turn on LinkedIn under Privacy and contact."
                error={errors.linkedinUrl}
              >
                {(c) => (
                  <Input
                    {...c}
                    type="url"
                    inputMode="url"
                    placeholder="https://www.linkedin.com/in/..."
                    value={draft.linkedinUrl}
                    onChange={(e) => set("linkedinUrl", e.target.value)}
                  />
                )}
              </SettingsField>
              <SettingsField
                form={FORM}
                name="websiteUrl"
                label="Personal website"
                optional
                privacy={professional ? "public" : "private"}
                error={errors.websiteUrl}
              >
                {(c) => (
                  <Input
                    {...c}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.websiteUrl}
                    onChange={(e) => set("websiteUrl", e.target.value)}
                  />
                )}
              </SettingsField>
            </div>
          </Card>

          <SaveRow label="Save profile" pending={save.isPending} dirty={dirty} onUndo={undo} />
        </div>

        <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="About your profile">
          <ProfileStatusCard profile={profile} />
          <KindCard profile={profile} />
        </aside>
      </form>
    </>
  );
}

type SetField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function ProfessionalFields({
  draft,
  set,
  errors,
  proposed,
}: {
  draft: Draft;
  set: SetField;
  errors: Record<string, string>;
  proposed: string[];
}) {
  const setEducation = (index: number, key: keyof EducationDraft, value: string) =>
    set(
      "education",
      draft.education.map((e, i) => (i === index ? { ...e, [key]: value } : e)),
    );
  const thisYear = new Date().getFullYear();

  return (
    <>
      <Card title="Your work">
        <div className="pn-form pn-form-2">
          <SettingsField form={FORM} name="title" label="Job title" privacy="public" error={errors.title}>
            {(c) => <Input {...c} autoComplete="organization-title" value={draft.title} onChange={(e) => set("title", e.target.value)} />}
          </SettingsField>
          <SettingsField
            form={FORM}
            name="organization"
            label="Company or institution"
            privacy="public"
            hint="Self-employed is fine."
            error={errors.organization}
          >
            {(c) => <Input {...c} autoComplete="organization" value={draft.organization} onChange={(e) => set("organization", e.target.value)} />}
          </SettingsField>
          <SettingsField form={FORM} name="disciplineId" label="Discipline" privacy="public" error={errors.disciplineId}>
            {(c) => (
              <Select {...c} value={draft.disciplineId} onChange={(e) => set("disciplineId", e.target.value)}>
                {draft.disciplineId === "" ? <option value="">Choose a discipline</option> : null}
                {disciplineGroups.map((g) => (
                  <optgroup key={g} label={g}>
                    {disciplines
                      .filter((d) => d.group === g)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </SettingsField>
          <SettingsField
            form={FORM}
            name="yearsExperience"
            label="Years of experience"
            privacy="private"
            hint="Others see a band, such as 10 to 19 years."
            error={errors.yearsExperience}
          >
            {(c) => (
              <Input
                {...c}
                type="number"
                inputMode="numeric"
                min={limits.yearsExperience.min}
                max={limits.yearsExperience.max}
                step={1}
                value={draft.yearsExperience}
                onChange={(e) => set("yearsExperience", e.target.value)}
              />
            )}
          </SettingsField>
          <SettingsField
            form={FORM}
            name="expertise"
            label="Expertise"
            privacy="public"
            className="pn-form-span"
            hint={
              <>
                Between {limits.expertise.min} and {limits.expertise.max}. Press Enter or a comma to add one.
                {proposed.length > 0 ? ` New tags wait for an administrator before others see them: ${proposed.join(", ")}.` : ""}
              </>
            }
            error={errors.expertise}
          >
            {(c) => (
              <TagInput
                id={c.id}
                describedBy={c["aria-describedby"]}
                invalid={c["aria-invalid"]}
                values={draft.expertise}
                max={limits.expertise.max}
                placeholder="Add an area of expertise"
                removeLabel={(v) => `Remove ${v}`}
                onChange={(v) => set("expertise", v)}
              />
            )}
          </SettingsField>
          <SettingsField
            form={FORM}
            name="interests"
            label="Professional interests"
            optional
            privacy="public"
            className="pn-form-span"
            hint={`Up to ${limits.interests.max}. Press Enter or a comma to add one.`}
            error={errors.interests}
          >
            {(c) => (
              <TagInput
                id={c.id}
                describedBy={c["aria-describedby"]}
                invalid={c["aria-invalid"]}
                values={draft.interests}
                max={limits.interests.max}
                placeholder="Add an interest"
                removeLabel={(v) => `Remove ${v}`}
                onChange={(v) => set("interests", v)}
              />
            )}
          </SettingsField>
        </div>
      </Card>

      <Card title="Education">
        {errors.education ? (
          <p className="field-error t-small mb-4" id={fieldId(FORM, "education")} tabIndex={-1}>
            {errors.education}
          </p>
        ) : null}
        {draft.education.length === 0 ? <p className="t-small text-fg-2">No education listed. It is optional.</p> : null}
        <ol className="pn-settings-edu">
          {draft.education.map((e, i) => (
            <li key={i} className="pn-settings-edu-item">
              <fieldset className="pn-fieldset">
                <legend className="t-small">Education {i + 1}</legend>
                <div className="pn-form pn-form-2">
                  <SettingsField form={FORM} name={`education.${i}.degree`} label="Degree" error={errors[`education.${i}.degree`]}>
                    {(c) => <Input {...c} placeholder="BS" value={e.degree} onChange={(ev) => setEducation(i, "degree", ev.target.value)} />}
                  </SettingsField>
                  <SettingsField form={FORM} name={`education.${i}.field`} label="Field" error={errors[`education.${i}.field`]}>
                    {(c) => <Input {...c} placeholder="Civil Engineering" value={e.field} onChange={(ev) => setEducation(i, "field", ev.target.value)} />}
                  </SettingsField>
                  <SettingsField form={FORM} name={`education.${i}.school`} label="School" error={errors[`education.${i}.school`]}>
                    {(c) => <Input {...c} value={e.school} onChange={(ev) => setEducation(i, "school", ev.target.value)} />}
                  </SettingsField>
                  <SettingsField form={FORM} name={`education.${i}.year`} label="Year" error={errors[`education.${i}.year`]}>
                    {(c) => (
                      <Input
                        {...c}
                        type="number"
                        inputMode="numeric"
                        min={fieldLimits.educationYear.min}
                        max={thisYear + fieldLimits.educationYear.yearsAhead}
                        step={1}
                        value={e.year}
                        onChange={(ev) => setEducation(i, "year", ev.target.value)}
                      />
                    )}
                  </SettingsField>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-4"
                  onClick={() => set("education", draft.education.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Remove education {i + 1}
                </button>
              </fieldset>
            </li>
          ))}
        </ol>
        {draft.education.length < limits.education.max ? (
          <button
            type="button"
            className="btn btn-outline btn-sm mt-4"
            onClick={() => set("education", [...draft.education, { degree: "", field: "", school: "", year: "" }])}
          >
            <Plus size={14} aria-hidden="true" />
            Add education
          </button>
        ) : (
          <p className="t-small text-fg-2 mt-4">That is the most entries a profile can list ({limits.education.max}).</p>
        )}
      </Card>

      <Card title="How you take part">
        <fieldset className="pn-fieldset" aria-describedby={errors.participation ? `${fieldId(FORM, "participation")}-error` : undefined}>
          <legend className="t-small" id={fieldId(FORM, "participation")} tabIndex={-1}>
            Choose any. Being listed, being open to contact and mentoring are separate choices.
          </legend>
          <div className="pn-options">
            {participationOptions.map((o) => (
              <Option
                key={o.id}
                multi
                checked={draft.participation.includes(o.id)}
                title={o.label}
                note={
                  o.id === "directory"
                    ? `${o.note} Without it your profile is not listed anywhere.`
                    : o.id === "mentoring"
                      ? `${o.note} Topics, audience and capacity are under Mentorship.`
                      : o.note
                }
                onClick={() =>
                  set(
                    "participation",
                    draft.participation.includes(o.id)
                      ? draft.participation.filter((x) => x !== o.id)
                      : participationOptions.map((x) => x.id).filter((x) => x === o.id || draft.participation.includes(x)),
                  )
                }
              />
            ))}
          </div>
          {errors.participation ? (
            <p id={`${fieldId(FORM, "participation")}-error`} className="field-error t-small">
              {errors.participation}
            </p>
          ) : null}
        </fieldset>
      </Card>
    </>
  );
}

function StudentFields({ draft, set, errors }: { draft: Draft; set: SetField; errors: Record<string, string> }) {
  const topics = withChosen(useTopics(), draft.topicsNeeded);
  const toggleTopic = (id: string) =>
    set(
      "topicsNeeded",
      draft.topicsNeeded.includes(id) ? draft.topicsNeeded.filter((t) => t !== id) : [...draft.topicsNeeded, id],
    );
  return (
    <Card title="Your studies">
      <div className="pn-form pn-form-2">
        <SettingsField form={FORM} name="program" label="Program" privacy="private" hint="For example BS Civil Engineering." error={errors.program}>
          {(c) => <Input {...c} value={draft.program} onChange={(e) => set("program", e.target.value)} />}
        </SettingsField>
        <SettingsField form={FORM} name="level" label="Level" privacy="private" error={errors.level}>
          {(c) => (
            <Select {...c} value={draft.level} onChange={(e) => set("level", e.target.value as AudienceId)}>
              {draft.level === "" ? <option value="">Choose your level</option> : null}
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </SettingsField>
        <SettingsField form={FORM} name="institution" label="Institution" privacy="private" className="pn-form-span" error={errors.institution}>
          {(c) => <Input {...c} value={draft.institution} onChange={(e) => set("institution", e.target.value)} />}
        </SettingsField>
        <SettingsField
          form={FORM}
          name="goals"
          label="What you are working toward"
          privacy="private"
          className="pn-form-span"
          hint={<CharCount value={draft.goals} min={limits.goals.min} max={limits.goals.max} />}
          error={errors.goals}
        >
          {(c) => <Textarea {...c} value={draft.goals} onChange={(e) => set("goals", e.target.value)} />}
        </SettingsField>
        <fieldset className="pn-fieldset pn-form-span">
          <legend className="t-small" id={fieldId(FORM, "topicsNeeded")} tabIndex={-1}>
            Topics you want help with ({limits.topicsNeeded.min} to {limits.topicsNeeded.max})
          </legend>
          <div className="pn-chips">
            {topics.map((t) => (
              <Chip
                key={t.id}
                pressed={draft.topicsNeeded.includes(t.id)}
                disabled={!draft.topicsNeeded.includes(t.id) && draft.topicsNeeded.length >= limits.topicsNeeded.max}
                onClick={() => toggleTopic(t.id)}
              >
                {t.label}
              </Chip>
            ))}
          </div>
          {errors.topicsNeeded ? <p className="field-error t-small">{errors.topicsNeeded}</p> : null}
          <p className="pn-field-hint">Private. Used to suggest mentors who offer these topics.</p>
        </fieldset>
        <SettingsField
          form={FORM}
          name="interests"
          label="Interests"
          optional
          privacy="private"
          className="pn-form-span"
          hint={`Up to ${limits.interests.max}. Press Enter or a comma to add one.`}
          error={errors.interests}
        >
          {(c) => (
            <TagInput
              id={c.id}
              describedBy={c["aria-describedby"]}
              invalid={c["aria-invalid"]}
              values={draft.interests}
              max={limits.interests.max}
              placeholder="Add an interest"
              removeLabel={(v) => `Remove ${v}`}
              onChange={(v) => set("interests", v)}
            />
          )}
        </SettingsField>
      </div>
    </Card>
  );
}

/** Where the profile stands: listed, waiting for review, or sent back with notes. */
function ProfileStatusCard({ profile }: { profile: OwnProfile }) {
  if (profile.kind === "student") {
    return (
      <Card title="Who sees this" lift>
        <ul className="grid gap-3 t-small text-fg-2">
          <li>Your profile is never listed in the directory.</li>
          <li>A mentor sees it only when you send them a request.</li>
          <li>Your sign-in email is never shown to anyone.</li>
        </ul>
      </Card>
    );
  }
  const verified = profile.professional?.verified ?? false;
  const review = profile.review;
  return (
    <Card
      title="Your listing"
      lift
      aside={
        profile.adminHidden ? (
          <Status tone="off" label="Hidden by an administrator" />
        ) : profile.approvalState === "pending" ? (
          <Status tone="pending" label="Pending review" />
        ) : profile.approvalState === "declined" ? (
          <Status tone="declined" label="Needs changes" />
        ) : (
          <Status tone="approved" label="Listed" />
        )
      }
    >
      {profile.adminHidden ? (
        <p className="t-small text-fg-2">An administrator has hidden your profile. Nobody else can see it until they restore it.</p>
      ) : profile.approvalState === "pending" ? (
        <p className="t-small text-fg-2">
          Waiting for review. An administrator checks every professional profile before it is listed. You can keep editing
          meanwhile.
        </p>
      ) : profile.approvalState === "declined" ? (
        <>
          <p className="t-small text-fg-2">An administrator asked for changes before your profile is listed.</p>
          {review?.notes ? <blockquote className="pn-settings-notes t-small">{review.notes}</blockquote> : null}
        </>
      ) : (
        <p className="t-small text-fg-2">Your profile is approved. Who can find it is under Privacy and contact.</p>
      )}
      {verified ? (
        <p className="t-small text-fg-2 mt-4 flex gap-2">
          <ShieldCheck size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
          Affiliation verified. Changing your title or organization removes the mark until it is checked again.
        </p>
      ) : null}
      <UiLink to="/settings/preview" className="link t-small mt-4 inline-flex">
        Preview as a visitor or a member
      </UiLink>
    </Card>
  );
}

/** Student or professional, and the switch between them. */
function KindCard({ profile }: { profile: OwnProfile }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const setKind = useSetKind();
  const toProfessional = profile.kind === "student";
  const target = toProfessional ? "professional" : "student";

  return (
    <Card title="Account type">
      <p className="t-small text-fg-2">
        {toProfessional
          ? "You have a student profile. If you now work in engineering, science or technology, you can switch to a professional profile."
          : "You have a professional profile. If you mainly want guidance, you can switch to a student profile."}
      </p>
      <button type="button" className="btn btn-outline btn-sm mt-4" onClick={() => setOpen(true)}>
        Switch to a {target} profile
      </button>
      {done ? (
        <div className="mt-4">
          <Toast text={done} />
        </div>
      ) : null}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Switch to a ${target} profile?`}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-solid btn-sm"
              disabled={setKind.isPending}
              aria-busy={setKind.isPending || undefined}
              onClick={() =>
                setKind.mutate(target, {
                  onSuccess: () => {
                    setOpen(false);
                    setDone(
                      toProfessional
                        ? "You now have a professional profile. Fill in your work details and save them to submit it; an administrator reviews it before it is listed."
                        : "You now have a student profile. It is not listed in the directory.",
                    );
                  },
                })
              }
            >
              {setKind.isPending ? "Switching" : `Switch to ${target}`}
            </button>
          </>
        }
      >
        <p>
          {toProfessional
            ? "Once you save your work details, your profile goes to the approval queue and is listed when an administrator approves it. Your saved profiles and your requests stay as they are."
            : "Your profile leaves the directory and mentorship is turned off. Mentees you already work with keep their history. Your saved profiles and your requests stay as they are."}
        </p>
        {setKind.isError ? (
          <div role="alert" className="mt-4">
            <Notice tone="warn">{settingsErrorText(setKind.error)}</Notice>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
