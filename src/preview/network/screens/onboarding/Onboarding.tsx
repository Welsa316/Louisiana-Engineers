import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Lock } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useStore } from "../../state/store";
import {
  audiences,
  contactMethods,
  disciplineGroups,
  disciplines,
  mentorshipTopics,
  participationOptions,
  type AudienceId,
  type ContactMethodId,
  type MentorshipTopic,
  type ParticipationId,
} from "../../data/taxonomy";
import { Card, Chip, Field, Input, Notice, Option, PrivacyMark, Select, Steps, SwitchRow, Textarea } from "../../components/ui";

/* ====================================================================
   5. Student / mentee onboarding
   ==================================================================== */

const STUDENT_STEPS = ["About you", "What you need", "Privacy", "Done"];

export function StudentOnboarding() {
  const { dispatch } = useStore();
  const { navigate } = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    level: "undergrad" as AudienceId,
    program: "",
    institution: "",
    location: "New Orleans, LA",
    goals: "",
    topics: [] as MentorshipTopic[],
    interests: "",
    showToMentors: true,
    emailNotifications: true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const valid = [
    form.firstName.trim() && form.lastName.trim() && form.email.includes("@"),
    form.goals.trim().length >= 20 && form.topics.length > 0,
    true,
    true,
  ][step];

  return (
    <div className="shell pt-10 md:pt-14 pb-24">
      <div className="pn-onboard">
        <div className="pn-wizard">
          <Steps steps={STUDENT_STEPS} current={step} />

          {step === 0 && (
            <>
              <h1>Tell us who you are.</h1>
              <p className="pn-wizard-lead">Mentors see your name, where you study and what you are working toward. Nobody outside MEST sees any of it.</p>
              <div className="pn-wizard-body pn-form pn-form-2">
                <Field label="First name" privacy="members">
                  {(id) => <Input id={id} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" />}
                </Field>
                <Field label="Last name" privacy="members">
                  {(id) => <Input id={id} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" />}
                </Field>
                <Field label="Email" privacy="private" className="pn-form-span" hint="Used to sign in and for notifications you choose. Never shown to anyone.">
                  {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />}
                </Field>
                <Field label="Where you are" privacy="members">
                  {(id) => (
                    <Select id={id} value={form.level} onChange={(e) => set("level", e.target.value as AudienceId)}>
                      {audiences.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Program or role" privacy="members" hint="For example, BS Civil Engineering, junior.">
                  {(id) => <Input id={id} value={form.program} onChange={(e) => set("program", e.target.value)} />}
                </Field>
                <Field label="School or employer" privacy="members" optional>
                  {(id) => <Input id={id} value={form.institution} onChange={(e) => set("institution", e.target.value)} />}
                </Field>
                <Field label="General location" privacy="members">
                  {(id) => <Input id={id} value={form.location} onChange={(e) => set("location", e.target.value)} />}
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1>What would help right now?</h1>
              <p className="pn-wizard-lead">Specific beats general. "Choosing between an MPH and medical school" gets a better mentor than "career advice".</p>
              <div className="pn-wizard-body pn-form">
                <Field label="What are you working toward?" privacy="members" hint={<span className="pn-counter block">{form.goals.trim().length} characters, 20 minimum</span>}>
                  {(id) => <Textarea id={id} value={form.goals} onChange={(e) => set("goals", e.target.value)} placeholder="Land a coastal engineering internship for next summer and understand the path to a PE license." />}
                </Field>
                <fieldset className="pn-fieldset">
                  <legend className="t-small">Topics you want help with</legend>
                  <div className="pn-chips">
                    {mentorshipTopics.map((t) => (
                      <Chip key={t} pressed={form.topics.includes(t)} onClick={() => set("topics", form.topics.includes(t) ? form.topics.filter((x) => x !== t) : [...form.topics, t])}>
                        {t}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                <Field label="Fields that interest you" privacy="members" optional hint="Comma separated. Used to suggest mentors.">
                  {(id) => <Input id={id} value={form.interests} onChange={(e) => set("interests", e.target.value)} placeholder="Coastal engineering, water resources" />}
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Your privacy settings.</h1>
              <p className="pn-wizard-lead">Students are never listed in the public directory. These control what mentors see and what we send you.</p>
              <div className="pn-wizard-body">
                <Card flush className="px-5">
                  <SwitchRow title="Show my profile to mentors I request" note="Mentors see your name, program, goals and topics with each request. Turning this off means requests arrive without context, which mentors tend to decline." checked={form.showToMentors} onChange={(v) => set("showToMentors", v)} />
                  <SwitchRow title="Email me when a mentor responds" note="One email per response. No newsletters unless you opt in separately." checked={form.emailNotifications} onChange={(v) => set("emailNotifications", v)} />
                </Card>
                <div className="mt-6">
                  <Notice icon={<Lock size={16} aria-hidden="true" />}>
                    <strong>What mentors never see:</strong> your email address, your phone number, or any request you sent to someone else.
                  </Notice>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>Welcome, {form.firstName || "friend"}.</h1>
              <p className="pn-wizard-lead">Check your email for a link to confirm your address. Meanwhile, the directory is open.</p>
              <div className="pn-wizard-body grid gap-4">
                <Notice tone="ok" icon={<Check size={16} aria-hidden="true" />}>
                  Your account is ready. You can send up to three mentorship requests at a time.
                </Notice>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    className="btn btn-solid"
                    onClick={() => {
                      dispatch({ type: "setRole", role: "mentee" });
                      navigate("/me/discover");
                    }}
                  >
                    Find a mentor
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-outline" onClick={() => { dispatch({ type: "setRole", role: "mentee" }); navigate("/me"); }}>
                    Go to my dashboard
                  </button>
                </div>
                <p className="t-small text-fg-2">In the prototype you continue as Amina Rahman, the sample student.</p>
              </div>
            </>
          )}

          {step < 3 && (
            <div className="pn-wizard-foot">
              {step > 0 ? (
                <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </button>
              ) : (
                <Link to="/join" className="btn btn-ghost">
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </Link>
              )}
              <button type="button" className="btn btn-solid" disabled={!valid} onClick={() => setStep((s) => s + 1)}>
                {step === 2 ? "Create account" : "Continue"}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <aside className="pn-wizard-aside">
          <PrivacyLegend />
        </aside>
      </div>
    </div>
  );
}

function PrivacyLegend() {
  return (
    <Card title="Who sees what" lift>
      <ul className="grid gap-4 t-small text-fg-2">
        <li className="grid gap-1">
          <PrivacyMark level="public" />
          Anyone, including visitors who are not signed in.
        </li>
        <li className="grid gap-1">
          <PrivacyMark level="members" />
          Signed-in MEST members only. For students, only mentors you request.
        </li>
        <li className="grid gap-1">
          <PrivacyMark level="private" />
          You and MEST administrators. Never on a profile.
        </li>
      </ul>
    </Card>
  );
}

/* ====================================================================
   6. Professional onboarding, 7. mentor opt-in, 8. contact and privacy
   ==================================================================== */

const PRO_STEPS = ["About you", "Your work", "Participation", "Mentorship", "Privacy & contact", "Review"];

interface ProForm {
  firstName: string;
  lastName: string;
  credentials: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  linkedin: string;
  website: string;
  disciplineId: string;
  title: string;
  organization: string;
  years: string;
  expertise: string[];
  expertiseInput: string;
  education: string;
  interests: string;
  participation: ParticipationId[];
  mentorTopics: MentorshipTopic[];
  audience: AudienceId[];
  format: "one-time" | "recurring" | "either";
  mode: "online" | "in-person" | "either";
  availability: string;
  duration: 30 | 45 | 60;
  maxActive: number;
  visibility: "public" | "members";
  contact: ContactMethodId[];
  bookingUrl: string;
}

export function ProfessionalOnboarding() {
  const { dispatch } = useStore();
  const { navigate } = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ProForm>({
    firstName: "",
    lastName: "",
    credentials: "",
    email: "",
    phone: "",
    location: "New Orleans, LA",
    bio: "",
    linkedin: "",
    website: "",
    disciplineId: "",
    title: "",
    organization: "",
    years: "",
    expertise: [],
    expertiseInput: "",
    education: "",
    interests: "",
    participation: ["directory", "networking"],
    mentorTopics: [],
    audience: ["undergrad", "early-career"],
    format: "either",
    mode: "either",
    availability: "",
    duration: 45,
    maxActive: 3,
    visibility: "public",
    contact: ["mest"],
    bookingUrl: "",
  });
  const set = <K extends keyof ProForm>(k: K, v: ProForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIn = <K extends "participation" | "mentorTopics" | "audience" | "contact">(k: K, v: ProForm[K][number]) =>
    setForm((f) => {
      const list = f[k] as string[];
      return { ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });
  const mentoring = form.participation.includes("mentoring");

  // Skip the mentorship step when mentoring is not selected.
  const steps = mentoring ? PRO_STEPS : PRO_STEPS.filter((s) => s !== "Mentorship");
  const stepName = steps[step];

  const addExpertise = () => {
    const v = form.expertiseInput.trim().replace(/,$/, "");
    if (v && !form.expertise.includes(v)) set("expertise", [...form.expertise, v]);
    set("expertiseInput", "");
  };

  const valid: Record<string, boolean> = {
    "About you": Boolean(form.firstName.trim() && form.lastName.trim() && form.email.includes("@") && form.bio.trim().length >= 40),
    "Your work": Boolean(form.disciplineId && form.title.trim() && form.organization.trim() && form.years && form.expertise.length >= 2),
    Participation: form.participation.length > 0,
    Mentorship: form.mentorTopics.length > 0 && form.audience.length > 0,
    "Privacy & contact": form.contact.length > 0,
    Review: true,
  };

  const finish = () => {
    dispatch({ type: "toast", text: "Profile submitted. An administrator will review it within a few days." });
    dispatch({ type: "setRole", role: "mentor" });
    navigate("/mentor");
  };

  return (
    <div className="shell pt-10 md:pt-14 pb-24">
      <div className="pn-onboard">
        <div className="pn-wizard">
          <Steps steps={steps} current={step} />

          {stepName === "About you" && (
            <>
              <h1>Start with the basics.</h1>
              <p className="pn-wizard-lead">Your name, a short biography and where you are. The marks beside each field say who will see it.</p>
              <div className="pn-wizard-body pn-form pn-form-2">
                <Field label="First name" privacy="public">
                  {(id) => <Input id={id} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" />}
                </Field>
                <Field label="Last name" privacy="public">
                  {(id) => <Input id={id} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" />}
                </Field>
                <Field label="Credentials" privacy="public" optional hint="PE, PhD, MD. Shown after your name.">
                  {(id) => <Input id={id} value={form.credentials} onChange={(e) => set("credentials", e.target.value)} placeholder="PE" />}
                </Field>
                <Field label="General location" privacy="public" hint="City or area, not an address.">
                  {(id) => <Input id={id} value={form.location} onChange={(e) => set("location", e.target.value)} />}
                </Field>
                <Field label="Email" privacy="private" hint="Sign-in and notifications. A work address helps us verify your affiliation faster.">
                  {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />}
                </Field>
                <Field label="Phone" privacy="private" optional hint="Only ever shared with mentees you accept, and only if you choose phone as a contact method.">
                  {(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />}
                </Field>
                <Field label="Short biography" privacy="public" className="pn-form-span" hint={<span className="pn-counter block">{form.bio.trim().length} characters, 40 minimum. Write it the way you would introduce yourself at a MEST event.</span>}>
                  {(id) => <Textarea id={id} value={form.bio} onChange={(e) => set("bio", e.target.value)} placeholder="I design levee and marsh restoration projects along the Louisiana coast and lead a team of six engineers…" />}
                </Field>
                <Field label="LinkedIn" privacy="public" optional>
                  {(id) => <Input id={id} value={form.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="linkedin.com/in/…" />}
                </Field>
                <Field label="Website or portfolio" privacy="public" optional>
                  {(id) => <Input id={id} value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />}
                </Field>
              </div>
            </>
          )}

          {stepName === "Your work" && (
            <>
              <h1>What you do.</h1>
              <p className="pn-wizard-lead">This is what people search by. Two or more areas of expertise; add as many as fit.</p>
              <div className="pn-wizard-body pn-form pn-form-2">
                <Field label="Discipline" privacy="public" className="pn-form-span">
                  {(id) => (
                    <Select id={id} value={form.disciplineId} onChange={(e) => set("disciplineId", e.target.value)}>
                      <option value="">Choose one</option>
                      {disciplineGroups.map((g) => (
                        <optgroup key={g} label={g}>
                          {disciplines.filter((d) => d.group === g).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Job title" privacy="public">
                  {(id) => <Input id={id} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Senior Coastal Engineer" />}
                </Field>
                <Field label="Company or institution" privacy="public">
                  {(id) => <Input id={id} value={form.organization} onChange={(e) => set("organization", e.target.value)} />}
                </Field>
                <Field label="Years of experience" privacy="public">
                  {(id) => <Input id={id} type="number" min={0} max={60} inputMode="numeric" value={form.years} onChange={(e) => set("years", e.target.value)} />}
                </Field>
                <Field label="Areas of expertise" privacy="public" className="pn-form-span" hint="Press Enter or comma after each. For example: hydraulic modeling, permitting, team leadership.">
                  {(id) => (
                    <>
                      <Input
                        id={id}
                        value={form.expertiseInput}
                        onChange={(e) => set("expertiseInput", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addExpertise();
                          }
                        }}
                        onBlur={addExpertise}
                        placeholder="Type and press Enter"
                      />
                      {form.expertise.length > 0 && (
                        <div className="pn-chips mt-3">
                          {form.expertise.map((x) => (
                            <Chip key={x} pressed removable onClick={() => set("expertise", form.expertise.filter((y) => y !== x))}>
                              {x}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Field>
                <Field label="Education" privacy="public" optional className="pn-form-span" hint="One per line: degree, field, school, year.">
                  {(id) => <Textarea id={id} value={form.education} onChange={(e) => set("education", e.target.value)} placeholder={"MS, Coastal Engineering, a Louisiana research university, 2013"} style={{ minHeight: "5rem" }} />}
                </Field>
                <Field label="Professional interests" privacy="public" optional className="pn-form-span">
                  {(id) => <Input id={id} value={form.interests} onChange={(e) => set("interests", e.target.value)} placeholder="Sediment diversion, living shorelines" />}
                </Field>
              </div>
            </>
          )}

          {stepName === "Participation" && (
            <>
              <h1>How do you want to take part?</h1>
              <p className="pn-wizard-lead">Each of these is independent. You can be listed without being contactable, and contactable without mentoring. Change any of them later.</p>
              <div className="pn-wizard-body pn-options">
                {participationOptions.map((o) => (
                  <Option key={o.id} multi checked={form.participation.includes(o.id)} title={o.label} note={o.note} onClick={() => toggleIn("participation", o.id)} />
                ))}
              </div>
            </>
          )}

          {stepName === "Mentorship" && (
            <>
              <h1>Mentorship, on your terms.</h1>
              <p className="pn-wizard-lead">Requests outside these choices never reach you. Set the cap low to start; you can raise it.</p>
              <div className="pn-wizard-body pn-form">
                <fieldset className="pn-fieldset">
                  <legend className="t-small">Topics you will talk about</legend>
                  <div className="pn-chips">
                    {mentorshipTopics.map((t) => (
                      <Chip key={t} pressed={form.mentorTopics.includes(t)} onClick={() => toggleIn("mentorTopics", t)}>
                        {t}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="pn-fieldset">
                  <legend className="t-small">Who you would like to help</legend>
                  <div className="pn-chips">
                    {audiences.map((a) => (
                      <Chip key={a.id} pressed={form.audience.includes(a.id)} onClick={() => toggleIn("audience", a.id)}>
                        {a.label}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                <div className="pn-form pn-form-2">
                  <fieldset className="pn-fieldset">
                    <legend className="t-small">Format</legend>
                    <div className="pn-options" role="radiogroup">
                      {([["one-time", "One-time guidance", "A single conversation on a specific question."], ["recurring", "Recurring mentoring", "A few conversations over a semester or more."], ["either", "Either", "Decide per request."]] as const).map(([v, t, n]) => (
                        <Option key={v} name="format" checked={form.format === v} title={t} note={n} onClick={() => set("format", v)} />
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="pn-fieldset">
                    <legend className="t-small">Where</legend>
                    <div className="pn-options" role="radiogroup">
                      {([["online", "Online", "Video or phone."], ["in-person", "In person", "Around Greater New Orleans."], ["either", "Either", "Whatever suits the mentee."]] as const).map(([v, t, n]) => (
                        <Option key={v} name="mode" checked={form.mode === v} title={t} note={n} onClick={() => set("mode", v)} />
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div className="pn-form pn-form-2">
                  <Field label="General availability" privacy="public" hint="Shown on your profile so people ask at sensible times.">
                    {(id) => <Input id={id} value={form.availability} onChange={(e) => set("availability", e.target.value)} placeholder="Weekday evenings after 6 PM" />}
                  </Field>
                  <Field label="Usual meeting length" privacy="public">
                    {(id) => (
                      <Select id={id} value={String(form.duration)} onChange={(e) => set("duration", Number(e.target.value) as 30 | 45 | 60)}>
                        <option value="30">30 minutes</option>
                        <option value="45">45 minutes</option>
                        <option value="60">60 minutes</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Active mentees at once" privacy="public" hint="When you reach this number you show as full. Nobody can send you a request until something completes.">
                    {(id) => <Input id={id} type="number" min={1} max={10} inputMode="numeric" value={form.maxActive} onChange={(e) => set("maxActive", Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />}
                  </Field>
                </div>
              </div>
            </>
          )}

          {stepName === "Privacy & contact" && (
            <>
              <h1>Who can see you, and how they reach you.</h1>
              <p className="pn-wizard-lead">Your email and phone are never shown on your profile under any setting. Contact methods are revealed only to mentees you accept.</p>
              <div className="pn-wizard-body pn-form">
                <fieldset className="pn-fieldset">
                  <legend className="t-small">Directory visibility</legend>
                  <div className="pn-options pn-options-2" role="radiogroup">
                    <Option name="visibility" checked={form.visibility === "public"} title="Public" note="Anyone can find you, including search engines and visitors who are not signed in." onClick={() => set("visibility", "public")} />
                    <Option name="visibility" checked={form.visibility === "members"} title="Members only" note="Only signed-in MEST members can see your profile." onClick={() => set("visibility", "members")} />
                  </div>
                </fieldset>
                <fieldset className="pn-fieldset">
                  <legend className="t-small">How accepted mentees and contacts may reach you</legend>
                  <div className="pn-options">
                    {contactMethods.map((c) => (
                      <Option key={c.id} multi checked={form.contact.includes(c.id)} title={c.label} note={c.note} onClick={() => (c.id === "mest" ? undefined : toggleIn("contact", c.id))} />
                    ))}
                  </div>
                  <p className="pn-field-hint">"Requests through MEST" is always on; it is how people reach you without seeing anything personal.</p>
                </fieldset>
                {form.contact.includes("booking") && (
                  <Field label="Scheduling link" privacy="members" hint="Shown to accepted mentees so they can book directly.">
                    {(id) => <Input id={id} value={form.bookingUrl} onChange={(e) => set("bookingUrl", e.target.value)} placeholder="https://cal.com/…" />}
                  </Field>
                )}
              </div>
            </>
          )}

          {stepName === "Review" && (
            <>
              <h1>Almost there.</h1>
              <p className="pn-wizard-lead">A MEST administrator reviews every professional profile before it is listed, usually within a few days. You will get an email either way.</p>
              <div className="pn-wizard-body grid gap-5">
                <Card flush>
                  <dl className="pn-dl p-5 t-small">
                    <dt>Name</dt>
                    <dd>
                      {form.firstName} {form.lastName}
                      {form.credentials && `, ${form.credentials}`}
                    </dd>
                    <dt>Role</dt>
                    <dd>
                      {form.title} · {form.organization}
                    </dd>
                    <dt>Discipline</dt>
                    <dd>{disciplines.find((d) => d.id === form.disciplineId)?.label}</dd>
                    <dt>Expertise</dt>
                    <dd>{form.expertise.join(", ")}</dd>
                    <dt>Listed as</dt>
                    <dd>{form.visibility === "public" ? "Public" : "Members only"}</dd>
                    <dt>Taking part in</dt>
                    <dd>{form.participation.map((p) => participationOptions.find((o) => o.id === p)?.label).join(", ")}</dd>
                    {mentoring && (
                      <>
                        <dt>Mentoring</dt>
                        <dd>
                          {form.mentorTopics.length} topics · up to {form.maxActive} mentees · {form.duration} min
                        </dd>
                      </>
                    )}
                    <dt>Reachable by</dt>
                    <dd>{form.contact.map((c) => contactMethods.find((x) => x.id === c)?.label).join(", ")}</dd>
                  </dl>
                </Card>
                <Notice icon={<Lock size={16} aria-hidden="true" />}>
                  Your email{form.phone ? " and phone" : ""} stay private. Everything else above will appear on your profile once approved.
                </Notice>
              </div>
            </>
          )}

          <div className="pn-wizard-foot">
            {step > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
            ) : (
              <Link to="/join" className="btn btn-ghost">
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </Link>
            )}
            {stepName === "Review" ? (
              <button type="button" className="btn btn-solid" onClick={finish}>
                Submit for review
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="btn btn-solid" disabled={!valid[stepName]} onClick={() => setStep((s) => s + 1)}>
                Continue
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <aside className="pn-wizard-aside grid gap-4">
          <PrivacyLegend />
          {stepName === "Participation" && (
            <Card lift>
              <p className="t-small text-fg-2">Most members start with the directory and networking only, and switch mentoring on after their first MEST event. That is fine.</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
