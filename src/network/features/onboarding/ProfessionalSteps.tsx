/**
 * The professional path (03 section 5, steps 3a and 4): work details, how
 * they take part, the mentorship offer (only when mentoring is chosen),
 * directory visibility and contact. Visibility and contact are separate
 * settings: being listed publicly never makes a contact detail public.
 */

import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { ChevronDown, Lock, Plus, Trash2 } from "lucide-react";
import { limits } from "@shared/limits";
import {
  audiences,
  disciplineGroups,
  disciplines,
  participationOptions,
  type ParticipationId,
} from "@shared/taxonomy";
import { useTopics, withChosen } from "../../lib/vocabulary";
import { ContactMatrix } from "../../ui/onboarding-contact";
import { ChipChoices, OnbField, OnbFieldset, TagInput } from "../../ui/onboarding-fields";
import { Input, Notice, Option } from "../../ui/ui";
import { REQUIRED_NOTE, StepHeading, type StepProps } from "./CommonSteps";
import { fieldId, type MentorshipValues, type OnboardingValues } from "./form";

/* ---------------------------------------------------------------- work */

export function WorkStep({ headingRef, err }: StepProps) {
  const { register, control, setValue } = useFormContext<OnboardingValues>();
  const expertise = useWatch({ control, name: "expertise" });
  const interests = useWatch({ control, name: "interests" });
  const education = useFieldArray({ control, name: "education" });

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead={`This is what people search by. ${REQUIRED_NOTE}`}
      >
        What you do.
      </StepHeading>

      <div className="pn-wizard-body pn-form pn-form-2">
        <OnbField id={fieldId("disciplineId")} label="Discipline" privacy="public" className="pn-form-span" error={err("disciplineId")}>
          {(a11y) => (
            <div className="select-wrap">
              <select {...a11y} {...register("disciplineId")}>
                <option value="">Choose one</option>
                {disciplineGroups.map((group) => (
                  <optgroup key={group} label={group}>
                    {disciplines
                      .filter((d) => d.group === group)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          )}
        </OnbField>
        <OnbField id={fieldId("title")} label="Job title" privacy="public" error={err("title")}>
          {(a11y) => <Input {...a11y} {...register("title")} autoComplete="organization-title" placeholder="Senior Coastal Engineer" />}
        </OnbField>
        <OnbField
          id={fieldId("organization")}
          label="Company or institution"
          privacy="public"
          error={err("organization")}
          hint="Self-employed is fine."
        >
          {(a11y) => <Input {...a11y} {...register("organization")} autoComplete="organization" />}
        </OnbField>
        <OnbField
          id={fieldId("yearsExperience")}
          label="Years of experience"
          privacy="public"
          error={err("yearsExperience")}
          hint="Shown as a range, such as 10 to 19 years. The exact number stays private."
        >
          {(a11y) => (
            <Input
              {...a11y}
              {...register("yearsExperience")}
              type="number"
              min={limits.yearsExperience.min}
              max={limits.yearsExperience.max}
              inputMode="numeric"
            />
          )}
        </OnbField>

        <OnbField
          id={fieldId("expertise")}
          label="Areas of expertise"
          privacy="public"
          className="pn-form-span"
          error={err("expertise")}
          hint={`At least ${limits.expertise.min}, up to ${limits.expertise.max}. Press Enter after each. New areas show on your profile once an administrator approves the wording.`}
        >
          {(a11y) => (
            <TagInput
              id={a11y.id}
              invalid={a11y["aria-invalid"]}
              describedBy={a11y["aria-describedby"]}
              values={expertise}
              max={limits.expertise.max}
              itemLabel="area of expertise"
              placeholder="Hydraulic modeling"
              onChange={(next) => setValue("expertise", next, { shouldDirty: true })}
            />
          )}
        </OnbField>

        <OnbField
          id={fieldId("interests")}
          label="Professional interests"
          optional
          privacy="public"
          className="pn-form-span"
          error={err("interests")}
          hint={`Up to ${limits.interests.max}.`}
        >
          {(a11y) => (
            <TagInput
              id={a11y.id}
              invalid={a11y["aria-invalid"]}
              describedBy={a11y["aria-describedby"]}
              values={interests}
              max={limits.interests.max}
              itemLabel="interest"
              placeholder="Living shorelines"
              onChange={(next) => setValue("interests", next, { shouldDirty: true })}
            />
          )}
        </OnbField>

        <OnbFieldset
          id={fieldId("education")}
          legend="Education"
          optional
          privacy="public"
          className="pn-form-span"
          error={err("education")}
        >
          <div className="onb-edu">
            {education.fields.map((entry, i) => (
              <div key={entry.id} className="onb-edu-item">
                <div className="onb-edu-head">
                  <span>Entry {i + 1}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => education.remove(i)}>
                    <Trash2 size={14} aria-hidden="true" />
                    Remove<span className="sr-only"> education entry {i + 1}</span>
                  </button>
                </div>
                <div className="pn-form pn-form-2">
                  <OnbField id={fieldId(`education.${i}.degree`)} label="Degree" error={err(`education.${i}.degree`)}>
                    {(a11y) => <Input {...a11y} {...register(`education.${i}.degree`)} placeholder="MS" />}
                  </OnbField>
                  <OnbField id={fieldId(`education.${i}.field`)} label="Field" error={err(`education.${i}.field`)}>
                    {(a11y) => <Input {...a11y} {...register(`education.${i}.field`)} placeholder="Coastal Engineering" />}
                  </OnbField>
                  <OnbField id={fieldId(`education.${i}.school`)} label="School" error={err(`education.${i}.school`)}>
                    {(a11y) => <Input {...a11y} {...register(`education.${i}.school`)} />}
                  </OnbField>
                  <OnbField id={fieldId(`education.${i}.year`)} label="Year" error={err(`education.${i}.year`)}>
                    {(a11y) => <Input {...a11y} {...register(`education.${i}.year`)} type="number" inputMode="numeric" placeholder="2013" />}
                  </OnbField>
                </div>
              </div>
            ))}
            {education.fields.length < limits.education.max ? (
              <div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => education.append({ degree: "", field: "", school: "", year: "" })}
                >
                  <Plus size={14} aria-hidden="true" />
                  Add education
                </button>
              </div>
            ) : (
              <p className="pn-field-hint">You can list up to {limits.education.max}.</p>
            )}
          </div>
        </OnbFieldset>
      </div>
    </>
  );
}

/* -------------------------------------------------------- participation */

export function ParticipationStep({ headingRef, err }: StepProps) {
  const { control, setValue } = useFormContext<OnboardingValues>();
  const participation = useWatch({ control, name: "participation" });
  const toggle = (id: ParticipationId) =>
    setValue(
      "participation",
      participation.includes(id) ? participation.filter((p) => p !== id) : [...participation, id],
      { shouldDirty: true },
    );

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead="Each of these is independent. You can be listed without mentoring, and mentor without being listed. Change any of them later."
      >
        How do you want to take part?
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        <OnbFieldset id={fieldId("participation")} legend="I would like to" optional privacy="public" error={err("participation")} hint="Shown as badges on your profile.">
          <div className="pn-options">
            {participationOptions.map((o) => (
              <Option key={o.id} multi checked={participation.includes(o.id)} title={o.label} note={o.note} onClick={() => toggle(o.id)} />
            ))}
          </div>
        </OnbFieldset>
        {participation.includes("directory") ? null : (
          <Notice tone="warn">
            Without the professional directory your profile is not listed or searchable, even after it is approved.
          </Notice>
        )}
        {participation.includes("mentoring") ? (
          <Notice tone="info">The next step sets up your mentorship offer.</Notice>
        ) : null}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- mentorship */

const FORMATS: [MentorshipValues["format"], string, string][] = [
  ["one-time", "One-time guidance", "A single conversation on a specific question."],
  ["recurring", "Recurring mentoring", "A few conversations over a semester or more."],
  ["either", "Either", "Decide per request."],
];

const MODES: [MentorshipValues["mode"], string, string][] = [
  ["online", "Online", "Video or phone."],
  ["in-person", "In person", "Around Greater New Orleans."],
  ["either", "Either", "Whatever suits the mentee."],
];

export function MentorshipStep({ headingRef, err }: StepProps) {
  const { register, control, setValue } = useFormContext<OnboardingValues>();
  const m = useWatch({ control, name: "mentorship" });
  const topics = withChosen(useTopics(), m.topics);
  const set = <K extends keyof MentorshipValues>(key: K, value: MentorshipValues[K]) =>
    setValue(`mentorship.${key}`, value as never, { shouldDirty: true });

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead={`Requests outside these choices never reach you. Start with a low cap; you can raise it. ${REQUIRED_NOTE}`}
      >
        Mentorship, on your terms.
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        <OnbFieldset id={fieldId("mentorship.topics")} legend="Topics you will talk about" privacy="public" error={err("mentorship.topics")}>
          <ChipChoices options={topics} values={m.topics} onChange={(next) => set("topics", next)} />
        </OnbFieldset>
        <OnbFieldset id={fieldId("mentorship.audience")} legend="Who you would like to help" privacy="public" error={err("mentorship.audience")}>
          <ChipChoices options={audiences} values={m.audience} onChange={(next) => set("audience", next)} />
        </OnbFieldset>

        <div className="pn-form pn-form-2">
          <OnbFieldset id={fieldId("mentorship.format")} legend="Format" privacy="public" error={err("mentorship.format")}>
            <div className="pn-options">
              {FORMATS.map(([value, title, note]) => (
                <Option key={value} name="onb-format" checked={m.format === value} title={title} note={note} onClick={() => set("format", value)} />
              ))}
            </div>
          </OnbFieldset>
          <OnbFieldset id={fieldId("mentorship.mode")} legend="Where" privacy="public" error={err("mentorship.mode")}>
            <div className="pn-options">
              {MODES.map(([value, title, note]) => (
                <Option key={value} name="onb-mode" checked={m.mode === value} title={title} note={note} onClick={() => set("mode", value)} />
              ))}
            </div>
          </OnbFieldset>
        </div>

        <div className="pn-form pn-form-2">
          <OnbField
            id={fieldId("mentorship.availabilityText")}
            label="General availability"
            optional
            privacy="public"
            className="pn-form-span"
            error={err("mentorship.availabilityText")}
            hint="Shown on your profile so people ask at sensible times."
          >
            {(a11y) => <Input {...a11y} {...register("mentorship.availabilityText")} placeholder="Weekday evenings after 6 PM" />}
          </OnbField>
          <OnbField id={fieldId("mentorship.durationMin")} label="Usual meeting length" privacy="public" error={err("mentorship.durationMin")}>
            {(a11y) => (
              <div className="select-wrap">
                <select {...a11y} {...register("mentorship.durationMin")}>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            )}
          </OnbField>
          <OnbField
            id={fieldId("mentorship.maxActive")}
            label="Active mentees at once"
            privacy="private"
            error={err("mentorship.maxActive")}
            hint={`${limits.maxActive.min} to ${limits.maxActive.max}. At this number you show as full and new requests wait until one finishes. Others see only whether you have room.`}
          >
            {(a11y) => (
              <Input
                {...a11y}
                {...register("mentorship.maxActive")}
                type="number"
                min={limits.maxActive.min}
                max={limits.maxActive.max}
                inputMode="numeric"
              />
            )}
          </OnbField>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- visibility */

export function VisibilityStep({ headingRef, err }: StepProps) {
  const { control, setValue } = useFormContext<OnboardingValues>();
  const visibility = useWatch({ control, name: "visibility" });

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead="Who can open your profile once an administrator approves it. Contact details are a separate choice on the next step."
      >
        Who can see your profile.
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        <OnbFieldset id={fieldId("visibility")} legend="Directory visibility" error={err("visibility")}>
          <div className="pn-options pn-options-2">
            <Option
              name="onb-visibility"
              checked={visibility === "public"}
              title="Public"
              note="Anyone can find your profile, including visitors who are not signed in and search engines."
              onClick={() => setValue("visibility", "public", { shouldDirty: true })}
            />
            <Option
              name="onb-visibility"
              checked={visibility === "members"}
              title="Members only"
              note="Only signed-in MEST members can find and open your profile."
              onClick={() => setValue("visibility", "members", { shouldDirty: true })}
            />
          </div>
        </OnbFieldset>
        <Notice icon={<Lock size={16} aria-hidden="true" />}>
          <strong>Either way, contact details are never public.</strong> A public profile shows your name, title,
          organization, discipline, expertise, biography, education and mentorship offer. How to reach you is shown
          only to signed-in, verified members, and only the methods you choose to show them.
        </Notice>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- contact */

export function ContactStep({ headingRef, err }: StepProps) {
  const { register, control, setValue } = useFormContext<OnboardingValues>();
  const contact = useWatch({ control, name: "contact" });
  const uses = (m: string) => contact.methods.includes(m as never);
  const matrixError = err("contact.methods") ?? err("contact.shareWithMembers");

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead="Methods you use are handed to mentees you accept. Methods you also show to signed-in members appear on your profile for them. Everything starts off except Requests through MEST."
      >
        How people reach you.
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        <OnbFieldset id={fieldId("contact.methods")} legend="Contact methods" privacy="members" error={matrixError}>
          <ContactMatrix
            id="onb-contact-matrix"
            methods={contact.methods}
            shared={contact.shareWithMembers}
            onChange={(next) => {
              setValue("contact.methods", next.methods, { shouldDirty: true });
              setValue("contact.shareWithMembers", next.shared, { shouldDirty: true });
            }}
          />
        </OnbFieldset>

        {uses("email") || uses("linkedin") || uses("booking") || uses("phone") ? (
          <div className="pn-form pn-form-2">
            {uses("email") ? (
              <OnbField
                id={fieldId("contact.contactEmail")}
                label="Email to share"
                optional
                privacy="members"
                error={err("contact.contactEmail")}
                hint="Leave empty to share the address you sign in with."
              >
                {(a11y) => <Input {...a11y} {...register("contact.contactEmail")} type="email" inputMode="email" autoComplete="email" />}
              </OnbField>
            ) : null}
            {uses("linkedin") ? (
              <OnbField id={fieldId("linkedinUrl")} label="LinkedIn link" privacy="members" error={err("linkedinUrl")}>
                {(a11y) => (
                  <Input {...a11y} {...register("linkedinUrl")} inputMode="url" placeholder="https://www.linkedin.com/in/…" />
                )}
              </OnbField>
            ) : null}
            {uses("booking") ? (
              <OnbField
                id={fieldId("contact.bookingUrl")}
                label="Scheduling link"
                privacy="members"
                error={err("contact.bookingUrl")}
                hint="Calendly, Cal.com or similar."
              >
                {(a11y) => <Input {...a11y} {...register("contact.bookingUrl")} inputMode="url" placeholder="https://cal.com/…" />}
              </OnbField>
            ) : null}
            {uses("phone") ? (
              <OnbField
                id={fieldId("contact.phone")}
                label="Phone number"
                privacy="members"
                error={err("contact.phone")}
                hint="Never public. Shown to signed-in members only if you tick that box above."
              >
                {(a11y) => <Input {...a11y} {...register("contact.phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 504 555 0100" />}
              </OnbField>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
