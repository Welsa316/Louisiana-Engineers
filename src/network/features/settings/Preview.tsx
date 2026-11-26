/**
 * Settings, Preview (PRO-13; 03 section 2.1 "Preview as visitor" and
 * "Preview as member"): the owner's profile exactly as a visitor who is not
 * signed in, or a signed-in member, would get it, from
 * `GET /api/me/preview?as=visitor|member`. A visitor never gets contact
 * details; a member gets only the methods shared with members. When the
 * answer is that the viewer cannot see the profile, the screen says why.
 */

import { useState, type ReactNode } from "react";
import { Briefcase, CalendarDays, ExternalLink, GraduationCap, Lock, MapPin, ShieldCheck } from "lucide-react";
import { audiences, contactMethods, experienceBands, topicById } from "@shared/taxonomy";
import type { ProfileView } from "@shared/types/directory";
import type { OwnProfile, PreviewProfile, PreviewResponse } from "@shared/types/me";
import type { ContactValue } from "@shared/types/profiles";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Monogram, Notice, PageHead, Segmented, Status, UiLink } from "../../ui/ui";
import { settingsErrorText, useOwnProfile, usePreview } from "./api";

type Viewer = PreviewResponse["as"];

export function Preview() {
  useMeta({ title: "Preview your profile" });
  const [as, setAs] = useState<Viewer>("visitor");
  const own = useOwnProfile();
  const preview = usePreview(as);
  const student = own.data?.kind === "student";

  return (
    <>
      <PageHead
        kicker="Preview"
        title="See your profile as others do."
        lead="Switch between a visitor who is not signed in and a signed-in member. This reads what is saved now."
      />
      {student ? (
        <div className="mt-8 max-w-2xl">
          <Notice tone="info" icon={<Lock size={16} aria-hidden="true" />}>
            Students are never listed, so visitors and members cannot open your profile. A mentor sees it only when you send
            them a request.
          </Notice>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <Segmented<Viewer>
              label="Preview as"
              value={as}
              onChange={setAs}
              options={[
                { id: "visitor", label: "Visitor" },
                { id: "member", label: "Member" },
              ]}
            />
          </div>
          <section className="pn-settings-preview mt-6" aria-label="Profile preview" aria-busy={preview.isFetching || undefined}>
            {preview.isError ? (
              <div role="alert">
                <Notice tone="warn">{settingsErrorText(preview.error)}</Notice>
              </div>
            ) : !preview.data || !own.data ? (
              <p className="t-small text-fg-2">Loading the preview</p>
            ) : preview.data.access === "visible" && preview.data.profile ? (
              <ProfilePreview profile={preview.data.profile} as={as} contact={preview.data.contact ?? []} />
            ) : preview.data.access === "members_only" ? (
              <Empty title="Members only.">
                {own.data.firstName ?? "This member"} chose to share this profile with signed-in members only. A visitor sees
                this and a prompt to sign in.
              </Empty>
            ) : (
              <Empty title="This profile is not available.">{unavailableReason(own.data, as)}</Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Why a viewer gets nothing, from the owner's own state. */
function unavailableReason(p: OwnProfile, as: Viewer): ReactNode {
  const who = as === "visitor" ? "Visitors" : "Members";
  if (p.adminHidden) return `${who} cannot see it: an administrator has hidden your profile.`;
  if (p.approvalState === "pending") return `${who} cannot see it yet: it is waiting for an administrator's review.`;
  if (p.approvalState === "declined") return `${who} cannot see it: an administrator asked for changes before it is listed.`;
  if (p.visibility === "hidden") {
    return (
      <>
        {who} cannot see it: you chose Hidden under{" "}
        <UiLink to="/settings/privacy" className="link">
          Privacy and contact
        </UiLink>
        .
      </>
    );
  }
  if (!p.professional?.participation.includes("directory")) {
    return (
      <>
        {who} cannot see it: Professional directory is off under{" "}
        <UiLink to="/settings/profile" className="link">
          Profile, How you take part
        </UiLink>
        .
      </>
    );
  }
  return `${who} cannot see it right now.`;
}

const PARTICIPATION_TAG: Record<string, string> = {
  networking: "Open to networking",
  mentoring: "Mentor",
  volunteering: "Volunteering",
  speaking: "Speaking",
  collaborating: "Collaborating",
};

function fullName(p: Pick<ProfileView, "firstName" | "lastName">): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unnamed member";
}

/** "January 15, 2027" from a calendar date, without a time zone moving the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** The profile page's content for the previewed viewer (03 section 6.2), without the viewer's own actions. */
function ProfilePreview({ profile: p, as, contact }: { profile: PreviewProfile; as: Viewer; contact: ContactValue[] }) {
  const band = experienceBands.find((b) => b.id === p.experienceBand)?.label;
  const name = fullName(p);
  const initials = `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const m = p.mentorship;

  return (
    <article className="pn-settings-preview-page">
      <header className="pn-profile-head">
        <Monogram initials={initials} size="xl" />
        <div className="min-w-0">
          <h2 className="pn-profile-name">
            {name}
            {p.credentials ? <small>{p.credentials}</small> : null}
          </h2>
          {p.title || p.organization ? (
            <p className="pn-profile-title">{[p.title, p.organization].filter(Boolean).join(" · ")}</p>
          ) : null}
          <div className="pn-profile-meta">
            {p.disciplineLabel ? (
              <span>
                <Briefcase size={14} aria-hidden="true" />
                {p.disciplineLabel}
              </span>
            ) : null}
            {p.location ? (
              <span>
                <MapPin size={14} aria-hidden="true" />
                {p.location}
              </span>
            ) : null}
            {band ? (
              <span>
                <CalendarDays size={14} aria-hidden="true" />
                {band}
              </span>
            ) : null}
            {p.verified ? (
              <span className="text-accent">
                <ShieldCheck size={14} aria-hidden="true" />
                Verified affiliation
              </span>
            ) : null}
          </div>
          {p.participation.some((x) => x !== "directory") ? (
            <ul className="pn-tags mt-5" aria-label="Open to">
              {p.participation
                .filter((x) => x !== "directory")
                .map((x) => (
                  <li key={x} className="pn-tag pn-tag-accent">
                    {PARTICIPATION_TAG[x] ?? x}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div className="pn-profile-body">
        <div className="min-w-0">
          {p.bio ? (
            <section className="pn-section">
              <h3>About</h3>
              <p className="t-body measure-wide">{p.bio}</p>
            </section>
          ) : null}
          {p.tags.length > 0 || p.interests.length > 0 ? (
            <section className="pn-section">
              <h3>Expertise</h3>
              <ul className="pn-tags">
                {p.tags.map((t) => (
                  <li key={t} className="pn-tag">
                    {t}
                  </li>
                ))}
              </ul>
              {p.interests.length > 0 ? (
                <>
                  <h4 className="t-small text-fg-2 mt-6 mb-2">Professional interests</h4>
                  <p className="t-body">{p.interests.join(" · ")}</p>
                </>
              ) : null}
            </section>
          ) : null}
          {p.education.length > 0 ? (
            <section className="pn-section">
              <h3>Education</h3>
              <ul className="pn-edu">
                {p.education.map((e) => (
                  <li key={`${e.degree}-${e.field}-${e.year}`} className="pn-edu-item">
                    <span className="pn-edu-year">{e.year}</span>
                    <span>
                      <span className="flex items-center gap-2">
                        <GraduationCap size={14} aria-hidden="true" className="text-fg-2" />
                        {e.degree}, {e.field}
                      </span>
                      <span className="text-fg-2 block">{e.school}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="pn-section">
            <h3>Contact</h3>
            {as === "visitor" ? (
              <p className="t-body text-fg-2">Sign in to see how to reach {p.firstName ?? "this member"}.</p>
            ) : contact.length === 0 ? (
              <p className="t-body text-fg-2">
                {p.firstName ?? "This member"} shares no contact details with members. Members can still send a request through
                MEST.
              </p>
            ) : (
              <dl className="pn-dl">
                {contact.map((c) => (
                  <ContactRow key={c.method} value={c} />
                ))}
              </dl>
            )}
          </section>
        </div>

        <div className="min-w-0">
          {m && m.status !== "off" ? (
            <Card
              title="Mentorship"
              className="pn-mentor-panel"
              aside={
                m.status === "paused" ? (
                  <Status tone="paused" label="Paused" />
                ) : m.hasCapacity ? (
                  <Status tone="active" label="Taking requests" />
                ) : (
                  <Status tone="off" label="Full" />
                )
              }
            >
              {m.status === "paused" ? (
                <p className="t-small text-fg-2 mb-4">
                  Not taking new requests right now{m.pausedUntil ? `, until ${longDate(m.pausedUntil)}` : ""}.
                </p>
              ) : !m.hasCapacity ? (
                <p className="t-small text-fg-2 mb-4">Not taking new requests right now.</p>
              ) : null}
              {m.topics.length > 0 ? (
                <>
                  <h4 className="t-small text-fg-2 mb-2">Can help with</h4>
                  <ul className="grid gap-1.5 t-small">
                    {m.topics.map((t) => (
                      <li key={t}>{topicById(t)?.label ?? t}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <dl className="pn-dl mt-5 t-small">
                <dt>For</dt>
                <dd>{m.audience.map((a) => audiences.find((x) => x.id === a)?.label ?? a).join(", ")}</dd>
                <dt>Format</dt>
                <dd>
                  {m.format === "either" ? "One-time or recurring" : m.format === "one-time" ? "One-time guidance" : "Recurring mentoring"}
                  {", "}
                  {m.mode === "either" ? "online or in person" : m.mode === "online" ? "online" : "in person"}
                </dd>
                {m.availability ? (
                  <>
                    <dt>Usually</dt>
                    <dd>{m.availability}</dd>
                  </>
                ) : null}
                <dt>Length</dt>
                <dd>{m.durationMin} minutes</dd>
              </dl>
            </Card>
          ) : (
            <Card title="Mentorship" lift>
              <p className="t-small text-fg-2">{p.firstName ?? "This member"} is not taking mentees.</p>
            </Card>
          )}
        </div>
      </div>
    </article>
  );
}

function ContactRow({ value }: { value: ContactValue }) {
  const label = contactMethods.find((c) => c.id === value.method)?.label ?? value.method;
  const href =
    value.method === "email"
      ? `mailto:${value.value}`
      : value.method === "phone"
        ? `tel:${value.value}`
        : /^https:\/\//.test(value.value)
          ? value.value
          : undefined;
  const external = value.method === "linkedin" || value.method === "booking";
  return (
    <>
      <dt>{label}</dt>
      <dd className="min-w-0 break-words">
        {href ? (
          <a className="link" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {value.value}
            {external ? <ExternalLink size={13} aria-hidden="true" className="inline ml-1 -mt-0.5" /> : null}
          </a>
        ) : (
          value.value
        )}
      </dd>
    </>
  );
}
