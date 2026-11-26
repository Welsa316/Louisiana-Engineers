/**
 * Step 5 (03 section 5): the profile as a visitor would see it and as a
 * member would see it, side by side on wider screens and as two tabs on a
 * phone. Students see who can read their profile instead (mentors they
 * request; nobody browses students). Built from the form values with the
 * same rules the server applies: experience shows as a band, contact details
 * are never public, members see only the methods shared with them.
 */

import { useState, type RefObject } from "react";
import { Pencil } from "lucide-react";
import {
  audiences,
  contactMethods,
  disciplineById,
  experienceBandFor,
  experienceBands,
  participationOptions,
  topicById,
  type ContactMethodId,
} from "@shared/taxonomy";
import { Monogram, Notice, Segmented } from "../../ui/ui";
import { StepHeading } from "./CommonSteps";
import { stepLabels, type OnboardingValues, type StepId } from "./form";

type Viewer = "visitor" | "member";

function initials(values: OnboardingValues): string {
  return `${values.firstName.trim().charAt(0)}${values.lastName.trim().charAt(0)}`.toUpperCase() || "?";
}

function fullName(values: OnboardingValues): string {
  const name = `${values.firstName.trim()} ${values.lastName.trim()}`.trim() || "Your name";
  return values.credentials.trim() ? `${name}, ${values.credentials.trim()}` : name;
}

const labelOf = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;

/** What a member is handed for each shared method, as `release_contact` resolves it. */
function contactLine(values: OnboardingValues, method: ContactMethodId): string {
  switch (method) {
    case "email":
      return values.contact.contactEmail.trim() || "The address you sign in with";
    case "linkedin":
      return values.linkedinUrl.trim();
    case "booking":
      return values.contact.bookingUrl.trim();
    case "phone":
      return values.contact.phone.trim();
    default:
      return "";
  }
}

function ProfessionalCard({ values, viewer }: { values: OnboardingValues; viewer: Viewer }) {
  const years = Number(values.yearsExperience);
  const band = Number.isFinite(years) && values.yearsExperience.trim() !== "" ? experienceBandFor(years) : null;
  const mentoring = values.participation.includes("mentoring");
  const shared = values.contact.shareWithMembers.filter((m) => m !== "mest" && values.contact.methods.includes(m));
  const discipline = disciplineById(values.disciplineId)?.label;

  if (viewer === "visitor" && values.visibility === "members") {
    return (
      <p className="onb-preview-empty">
        Visitors who are not signed in see only that this profile is for members, with a prompt to sign in.
      </p>
    );
  }

  return (
    <>
      <div className="onb-preview-head">
        <Monogram initials={initials(values)} />
        <div>
          <p className="onb-preview-name">{fullName(values)}</p>
          <p className="onb-preview-sub">
            {[values.title.trim(), values.organization.trim()].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <p className="onb-preview-sub">
        {[discipline, values.location.trim(), band ? experienceBands.find((b) => b.id === band)?.label : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {values.bio.trim() ? <p className="onb-preview-bio">{values.bio.trim()}</p> : null}
      {values.expertise.length ? (
        <div className="onb-preview-section">
          <h3>Expertise</h3>
          <ul className="pn-tags">
            {values.expertise.map((tag) => (
              <li key={tag} className="pn-tag">
                {tag}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {values.participation.length ? (
        <div className="onb-preview-section">
          <h3>Taking part in</h3>
          <p>{values.participation.map((p) => labelOf(participationOptions, p)).join(", ")}</p>
        </div>
      ) : null}
      {mentoring ? (
        <div className="onb-preview-section">
          <h3>Mentorship</h3>
          <p>
            {values.mentorship.topics.map((t) => topicById(t)?.label ?? t).join(", ") || "No topics yet"}
          </p>
          <p className="onb-preview-sub">
            For {values.mentorship.audience.map((a) => labelOf(audiences, a).toLowerCase()).join(", ") || "nobody yet"}
            {values.mentorship.availabilityText.trim() ? ` · ${values.mentorship.availabilityText.trim()}` : ""}
            {` · ${values.mentorship.durationMin} minutes`}
          </p>
        </div>
      ) : null}
      {values.education.length ? (
        <div className="onb-preview-section">
          <h3>Education</h3>
          <ul>
            {values.education.map((e, i) => (
              <li key={i}>{[e.degree, e.field, e.school, e.year].map((x) => x.trim()).filter(Boolean).join(", ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="onb-preview-section">
        <h3>How to reach them</h3>
        {viewer === "visitor" ? (
          <p className="onb-preview-empty">Sign in to see how to reach {values.firstName.trim() || "them"}.</p>
        ) : (
          <ul className="onb-preview-contact">
            <li>Requests through MEST</li>
            {shared.map((m) => (
              <li key={m}>
                {labelOf(contactMethods, m)}: {contactLine(values, m) || "not filled in"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function StudentCard({ values, viewer }: { values: OnboardingValues; viewer: Viewer }) {
  if (viewer === "visitor") {
    return (
      <p className="onb-preview-empty">
        Nothing. Student profiles are never listed or searchable, by visitors or by other members.
      </p>
    );
  }
  return (
    <>
      <div className="onb-preview-head">
        <Monogram initials={initials(values)} student />
        <div>
          <p className="onb-preview-name">{fullName(values)}</p>
          <p className="onb-preview-sub">
            {[values.level ? labelOf(audiences, values.level) : null, values.program.trim(), values.institution.trim()]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {values.location.trim() ? <p className="onb-preview-sub">{values.location.trim()}</p> : null}
      {values.goals.trim() ? (
        <div className="onb-preview-section">
          <h3>Working toward</h3>
          <p className="onb-preview-bio">{values.goals.trim()}</p>
        </div>
      ) : null}
      {values.bio.trim() ? <p className="onb-preview-bio">{values.bio.trim()}</p> : null}
      {values.interests.length ? (
        <div className="onb-preview-section">
          <h3>Interests</h3>
          <p>{values.interests.join(", ")}</p>
        </div>
      ) : null}
      <p className="onb-preview-empty">Your email address and the topics you chose are never shown.</p>
    </>
  );
}

export function ReviewStep({
  headingRef,
  values,
  steps,
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  values: OnboardingValues;
  steps: StepId[];
  onEdit: (step: StepId) => void;
}) {
  const [tab, setTab] = useState<Viewer>("visitor");
  const student = values.kind === "student";
  const panels: { id: Viewer; label: string }[] = student
    ? [
        { id: "visitor", label: "Visitors and members" },
        { id: "member", label: "Mentors you request" },
      ]
    : [
        { id: "visitor", label: "As a visitor" },
        { id: "member", label: "As a member" },
      ];

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead={
          student
            ? "This is everything other people can see. Finish to go to your home page and start finding mentors."
            : "A MEST administrator reviews every professional profile before it is listed, usually within a few days. You will get an email either way."
        }
      >
        {student ? "Check your profile." : "Almost there."}
      </StepHeading>

      <div className="pn-wizard-body grid gap-6">
        <div>
          <div className="onb-preview-tabs">
            <Segmented label="Preview" value={tab} options={panels} onChange={setTab} />
          </div>
          <div className="onb-previews">
            {panels.map((panel) => (
              <section
                key={panel.id}
                className="onb-preview"
                data-active={tab === panel.id}
                aria-labelledby={`onb-preview-${panel.id}`}
              >
                <h2 id={`onb-preview-${panel.id}`} className="onb-preview-label">
                  {panel.label}
                </h2>
                {student ? (
                  <StudentCard values={values} viewer={panel.id} />
                ) : (
                  <ProfessionalCard values={values} viewer={panel.id} />
                )}
              </section>
            ))}
          </div>
        </div>

        {student ? null : (
          <Notice>
            Listed as <strong>{values.visibility === "public" ? "Public" : "Members only"}</strong>. Your exact years of
            experience{values.contact.methods.includes("phone") ? ", your phone number unless you show it to members," : ""} and
            your mentee cap stay private. Change any of it later in settings.
          </Notice>
        )}

        <div>
          <h2 className="t-small text-fg-2 mb-3">Change something</h2>
          <div className="onb-edit-list">
            {steps
              .filter((s) => s !== "who" && s !== "review")
              .map((s) => (
                <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(s)}>
                  <Pencil size={14} aria-hidden="true" />
                  <span className="sr-only">Change </span>
                  {stepLabels[s]}
                </button>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
