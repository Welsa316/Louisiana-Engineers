/**
 * A professional's profile (`/network/directory/:id`, public shell; and
 * `/network/me/discover/:id` inside the app shell), ported from the
 * prototype. `GET /api/profiles/:id` decides what the viewer gets: the
 * profile, `403 members_only` (a members-only profile and a visitor), or
 * `404` (unknown, pending, hidden or a student). The owner sees their own
 * profile in any state, with a banner while it waits for review.
 *
 * Nothing here shows exact years, a mentor's `max_active` or a contact
 * value outside the Contact section, which only members can fill.
 */

import { useId, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Briefcase, CalendarDays, Clock, GraduationCap, MapPin, ShieldCheck } from "lucide-react";
import { audiences, experienceBands, participationOptions } from "@shared/taxonomy";
import type { ProfileMentorship, ProfileView } from "@shared/types/directory";
import type { ContactValue } from "@shared/types/profiles";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import type { SessionUser } from "@shared/types/auth";
import { useSession } from "../../lib/session";
import { Card, Empty, Monogram, Notice, Status } from "../../ui/ui";
import "../../ui/directory-pages.css";
import { ContactPanel, ContactPreview } from "./ContactPanel";
import { displayName, initialsOf, topicLabels, type DirectoryMode } from "./Directory";
import { useProfile } from "./directory-api";
import { isTakingRequests, offersMentorship, ProfileActions, type ProfileSlot } from "./ProfileActions";

const DESCRIPTION_CHARS = 150;

const FORMAT: Record<ProfileMentorship["format"], string> = {
  either: "One-time or recurring",
  "one-time": "One-time guidance",
  recurring: "Recurring mentoring",
};

const MODE: Record<ProfileMentorship["mode"], string> = {
  either: "online or in person",
  online: "online",
  "in-person": "in person",
};

/** "2026-12-01" as "December 1", read as a calendar day (no time zone shift). */
function calendarDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function describe(bio: string | null): string | undefined {
  const flat = (bio ?? "").replace(/\s+/g, " ").trim();
  return flat ? Array.from(flat).slice(0, DESCRIPTION_CHARS).join("").trimEnd() : undefined;
}

function Back({ mode }: { mode: DirectoryMode }) {
  const to = mode === "discover" ? "/me/discover" : "/directory";
  return (
    <div className="pt-6">
      <Link to={to} className="link link-quiet t-small">
        <ArrowLeft size={14} aria-hidden="true" />
        {mode === "discover" ? "Back to Find mentors" : "Back to the directory"}
      </Link>
    </div>
  );
}

function Frame({ mode, children }: { mode: DirectoryMode; children: ReactNode }) {
  return <div className={mode === "discover" ? "pb-12" : "shell pb-24"}>{children}</div>;
}

function MembersOnly({ mode }: { mode: DirectoryMode }) {
  const location = useLocation();
  useMeta({ title: "Members only" });
  return (
    <Frame mode={mode}>
      <Back mode={mode} />
      <div className="pn-profile-gate">
        <h1 className="t-display-sm">This profile is for signed-in members.</h1>
        <p className="t-body text-fg-2 measure-wide mt-4">
          This professional chose to share their profile with signed-in MEST members only. Sign in, or join the network,
          to see it.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <Link to="/signin" state={{ from: `${location.pathname}${location.search}` }} className="btn btn-solid btn-sm">
            Sign in
          </Link>
          <Link to="/join" className="btn btn-outline btn-sm">
            Join the network
          </Link>
        </div>
      </div>
    </Frame>
  );
}

function NotAvailable({ mode }: { mode: DirectoryMode }) {
  useMeta({ title: "Profile not available" });
  return (
    <Frame mode={mode}>
      <Back mode={mode} />
      <div className="pn-profile-gate">
        <h1 className="t-display-sm">This profile is not available.</h1>
        <p className="t-body text-fg-2 measure-wide mt-4">
          The link may be mistyped, or the profile is not listed right now.
        </p>
      </div>
    </Frame>
  );
}

function OwnerBanner({ profile }: { profile: ProfileView }) {
  if (!profile.isOwner) return null;
  if (profile.approvalState === "pending") {
    return (
      <div className="mt-6">
        <Notice tone="info" icon={<Clock size={16} aria-hidden="true" />}>
          <strong>Waiting for review.</strong> An administrator checks every new professional profile before it is
          listed. Until then only you can see this page.
        </Notice>
      </div>
    );
  }
  if (profile.approvalState === "declined") {
    return (
      <div className="mt-6">
        <Notice tone="warn">
          <strong>Needs changes.</strong> An administrator asked for changes before listing your profile. The notes
          are on your <Link to="/me" className="link">home page</Link>; only you can see this page until it is listed.
        </Notice>
      </div>
    );
  }
  if (profile.visibility === "hidden") {
    return (
      <div className="mt-6">
        <Notice tone="info">Your profile is hidden from the directory. Only you can see this page.</Notice>
      </div>
    );
  }
  return null;
}

function MentorshipPanel({ profile, firstName }: { profile: ProfileView; firstName: string }) {
  const m = profile.mentorship;
  if (!m || !offersMentorship(profile)) {
    const open = profile.participation.filter((p) => p === "networking" || p === "speaking");
    return (
      <Card title="Mentorship" lift>
        <p className="t-small text-fg-2">
          {firstName} is not taking mentees
          {open.length
            ? `, and is listed for ${open.map((p) => (p === "networking" ? "networking" : "speaking")).join(" and ")}`
            : ""}
          .
        </p>
      </Card>
    );
  }
  const taking = isTakingRequests(profile);
  const topics = topicLabels(m.topics);
  return (
    <Card
      title="Mentorship"
      aside={<Status tone={taking ? "active" : "off"} label={taking ? "Taking requests" : "Not taking new requests"} />}
      className="pn-mentor-panel"
    >
      {!taking && (
        <p className="t-small text-fg-2 mb-4">
          {m.status === "paused" && m.pausedUntil
            ? `Not taking new requests right now, until ${calendarDay(m.pausedUntil)}.`
            : "Not taking new requests right now."}
        </p>
      )}
      {topics.length > 0 && (
        <>
          <h3 className="t-small text-fg-2 mb-2">Can help with</h3>
          <ul className="grid gap-1.5 t-small">
            {topics.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-accent" aria-hidden="true">
                  ·
                </span>
                {t}
              </li>
            ))}
          </ul>
        </>
      )}
      <dl className="pn-dl mt-5 t-small">
        {m.audience.length > 0 && (
          <>
            <dt>For</dt>
            <dd>{m.audience.map((a) => audiences.find((x) => x.id === a)?.label ?? a).join(", ")}</dd>
          </>
        )}
        <dt>Format</dt>
        <dd>
          {FORMAT[m.format]}, {MODE[m.mode]}
        </dd>
        {m.availability && (
          <>
            <dt>Usually</dt>
            <dd>{m.availability}</dd>
          </>
        )}
        <dt>Length</dt>
        <dd>{m.durationMin} minutes</dd>
      </dl>
    </Card>
  );
}

export function ProfileBody({
  profile,
  mode,
  slot,
  reportSlot,
}: {
  profile: ProfileView;
  mode: DirectoryMode;
  slot?: ProfileSlot;
  reportSlot?: ProfileSlot;
}) {
  const { user } = useSession();
  const name = displayName({ firstName: profile.firstName, lastName: profile.lastName });
  const listed = profile.approvalState === undefined || profile.approvalState === "approved";
  const indexable = mode === "directory" && profile.visibility === "public" && listed;

  useMeta({
    title: profile.title ? `${name}, ${profile.title}` : name,
    description: describe(profile.bio),
    noindex: !indexable,
    canonical: indexable ? `/network/directory/${profile.id}` : undefined,
    og: indexable ? { type: "profile", url: `/network/directory/${profile.id}` } : undefined,
  });

  return (
    <>
      <OwnerBanner profile={profile} />
      <ProfileContent profile={profile} viewer={user} slot={slot} reportSlot={reportSlot} />
    </>
  );
}

/**
 * The profile itself, for a given viewer. The profile page passes the
 * session; the settings preview passes the previewed viewer and the contact
 * list its answer carries, so both render one component and cannot drift.
 */
export function ProfileContent({
  profile,
  viewer,
  slot,
  reportSlot,
  preview,
}: {
  profile: ProfileView;
  viewer: SessionUser | null;
  slot?: ProfileSlot;
  reportSlot?: ProfileSlot;
  /** Settings preview: the name becomes a level-2 heading and contact comes from the preview answer. */
  preview?: { as: "visitor" | "member"; contact: ContactValue[] };
}) {
  const aboutId = useId();
  const firstName = profile.firstName ?? "This member";
  const name = displayName({ firstName: profile.firstName, lastName: profile.lastName });
  const band = experienceBands.find((b) => b.id === profile.experienceBand)?.label;
  const openTo = profile.participation.filter((p) => p !== "directory");
  const Name = preview ? "h2" : "h1";

  return (
    <>
      <header className="pn-profile-head">
        <Monogram initials={initialsOf(profile)} size="xl" />
        <div className="min-w-0">
          <Name className="pn-profile-name">
            {name}
            {profile.credentials && <small>{profile.credentials}</small>}
          </Name>
          {(profile.title || profile.organization) && (
            <p className="pn-profile-title">{[profile.title, profile.organization].filter(Boolean).join(" · ")}</p>
          )}
          <div className="pn-profile-meta">
            {profile.disciplineLabel && (
              <span>
                <Briefcase size={14} aria-hidden="true" />
                {profile.disciplineLabel}
              </span>
            )}
            {profile.location && (
              <span>
                <MapPin size={14} aria-hidden="true" />
                {profile.location}
              </span>
            )}
            {band && (
              <span>
                <CalendarDays size={14} aria-hidden="true" />
                {band}
              </span>
            )}
            {profile.verified && (
              <span className="text-accent">
                <ShieldCheck size={14} aria-hidden="true" />
                Verified affiliation
              </span>
            )}
            {profile.visibility === "members" && (
              <span>Members only</span>
            )}
          </div>
        </div>
        {/* In a preview the actions are shown as the viewer would see them, but do nothing. */}
        <div inert={preview ? true : undefined} className="contents">
          <ProfileActions profile={profile} viewer={viewer} slot={slot} reportSlot={reportSlot} />
        </div>
      </header>

      <div className="pn-profile-body">
        <div>
          {profile.bio && (
            <section className="pn-section" aria-labelledby={aboutId}>
              <h2 id={aboutId}>About</h2>
              <p className="t-body measure-wide pn-profile-bio">{profile.bio}</p>
            </section>
          )}
          {(profile.tags.length > 0 || profile.interests.length > 0) && (
            <section className="pn-section">
              <h2>Expertise</h2>
              {profile.tags.length > 0 && (
                <ul className="pn-tags" aria-label="Expertise">
                  {profile.tags.map((tag) => (
                    <li key={tag} className="pn-tag">
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
              {profile.interests.length > 0 && (
                <>
                  <h3 className="t-small text-fg-2 mt-6 mb-2">Professional interests</h3>
                  <p className="t-body">{profile.interests.join(" · ")}</p>
                </>
              )}
            </section>
          )}
          {profile.education.length > 0 && (
            <section className="pn-section">
              <h2>Education</h2>
              <ul className="pn-edu">
                {profile.education.map((e) => (
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
          )}
          {openTo.length > 0 && (
            <section className="pn-section">
              <h2>Open to</h2>
              <ul className="pn-tags">
                {openTo.map((p) => (
                  <li key={p} className="pn-tag pn-tag-accent">
                    {participationOptions.find((o) => o.id === p)?.label ?? p}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview ? (
            <ContactPreview as={preview.as} methods={preview.contact} firstName={firstName} />
          ) : (
            <ContactPanel profileId={profile.id} firstName={firstName} isOwner={profile.isOwner} />
          )}
        </div>

        <aside aria-label="Mentorship">
          <MentorshipPanel profile={profile} firstName={firstName} />
        </aside>
      </div>
    </>
  );
}

export function Profile({
  mode = "directory",
  slot,
  reportSlot,
}: {
  mode?: DirectoryMode;
  /** Passed through to ProfileActions (Task 22's request buttons). */
  slot?: ProfileSlot;
  /** Passed through to ProfileActions (Task 24's report control). */
  reportSlot?: ProfileSlot;
}) {
  const { id = "" } = useParams();
  const query = useProfile(id);

  if (query.isPending) {
    return (
      <Frame mode={mode}>
        <Back mode={mode} />
        <div className="pn-dir-loading mt-8" role="status" aria-live="polite">
          <span className="sr-only">Loading the profile</span>
        </div>
      </Frame>
    );
  }
  if (query.isError) {
    if (isApiError(query.error, "members_only")) return <MembersOnly mode={mode} />;
    if (isApiError(query.error, "network") || (isApiError(query.error) && query.error.status >= 500)) {
      return (
        <Frame mode={mode}>
          <Back mode={mode} />
          <div className="mt-8">
            <Empty
              title="The profile did not load."
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void query.refetch()}>
                  Try again
                </button>
              }
            >
              Check your connection and try again.
            </Empty>
          </div>
        </Frame>
      );
    }
    return <NotAvailable mode={mode} />;
  }

  return (
    <Frame mode={mode}>
      <Back mode={mode} />
      <ProfileBody profile={query.data} mode={mode} slot={slot} reportSlot={reportSlot} />
    </Frame>
  );
}
