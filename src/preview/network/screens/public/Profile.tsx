import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, BookmarkCheck, Briefcase, CalendarDays, Flag, Globe, GraduationCap, Lock, MapPin, ShieldCheck } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useStore, isMentorAvailable, activeMenteeCount, openRequestCount, MAX_OPEN_REQUESTS } from "../../state/store";
import { audiences, contactMethods, disciplineById } from "../../data/taxonomy";
import { fullName, initials } from "../../data/mock";
import { Card, Empty, Modal, Monogram, Notice, Status, Textarea } from "../../components/ui";

/**
 * 3. Detailed professional profile (public) and 11. detailed mentor profile
 * (mentee). The page is the same; the action column depends on who is
 * looking and on the professional's own settings.
 */
export function Profile({ id, back }: { id: string; back: { to: string; label: string } }) {
  const { state, dispatch, me } = useStore();
  const { navigate } = useRouter();
  const p = state.professionals.find((x) => x.id === id);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState("");

  if (!p || (p.approval !== "approved" && state.role !== "admin")) {
    return (
      <div className="shell section">
        <Empty title="This profile is not available.">It may be awaiting review, or the member may have hidden it.</Empty>
      </div>
    );
  }
  if (p.visibility === "members" && state.role === "visitor") {
    return (
      <div className="shell section">
        <Empty title="Members only." action={<Link to="/signin" className="btn btn-solid btn-sm">Sign in</Link>}>
          {p.firstName} chose to share this profile with signed-in members only.
        </Empty>
      </div>
    );
  }

  const discipline = disciplineById(p.disciplineId);
  const available = isMentorAvailable(p, state.requests);
  const activeCount = activeMenteeCount(p.id, state.requests);
  const saved = state.saved.includes(p.id);
  const isMentee = state.role === "mentee";
  const existing = isMentee
    ? state.requests.find((r) => r.menteeId === me.mentee.id && r.mentorId === p.id && (r.status === "pending" || r.status === "accepted"))
    : undefined;
  const openCount = isMentee ? openRequestCount(me.mentee.id, state.requests) : 0;
  const atCap = openCount >= MAX_OPEN_REQUESTS;
  const canContact = p.participation.includes("networking");
  const inApp = state.role !== "visitor";

  return (
    <div className={inApp && state.role !== "visitor" && back.to.startsWith("/me") ? "" : "shell pb-24"}>
      <div className="pt-6">
        <Link to={back.to} className="link link-quiet t-small">
          <ArrowLeft size={14} aria-hidden="true" />
          {back.label}
        </Link>
      </div>

      <header className="pn-profile-head">
        <Monogram initials={initials(p)} size="xl" />
        <div className="min-w-0">
          <h1 className="pn-profile-name">
            {fullName(p)}
            {p.credentials && <small>{p.credentials}</small>}
          </h1>
          <p className="pn-profile-title">
            {p.title} · {p.organization}
          </p>
          <div className="pn-profile-meta">
            <span>
              <Briefcase size={14} aria-hidden="true" />
              {discipline?.label}
            </span>
            <span>
              <MapPin size={14} aria-hidden="true" />
              {p.location}
            </span>
            <span>
              <CalendarDays size={14} aria-hidden="true" />
              {p.yearsExperience} years
            </span>
            {p.verified && (
              <span className="text-accent">
                <ShieldCheck size={14} aria-hidden="true" />
                Affiliation verified
              </span>
            )}
          </div>
          <div className="pn-tags mt-5">
            {p.participation.filter((x) => x !== "directory").map((x) => (
              <span key={x} className="pn-tag pn-tag-accent">
                {x === "networking" ? "Open to networking" : x === "mentoring" ? "Mentor" : x[0].toUpperCase() + x.slice(1)}
              </span>
            ))}
          </div>
        </div>

        <div className="pn-profile-actions">
          {p.mentorship && isMentee && !existing && available && !atCap && (
            <Link to={`/me/request/${p.id}`} className="btn btn-solid">
              Request mentorship
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          )}
          {p.mentorship && isMentee && existing && (
            <Link to={`/me/requests/${existing.id}`} className="btn btn-outline">
              View your {existing.status} request
            </Link>
          )}
          {p.mentorship && isMentee && !existing && available && atCap && (
            <button type="button" className="btn btn-solid" disabled title="You already have three open requests">
              Request mentorship
            </button>
          )}
          {p.mentorship && isMentee && !existing && !available && (
            <button type="button" className="btn btn-outline" disabled>
              {p.mentorship.status === "paused" ? "Mentorship paused" : "Not taking new mentees"}
            </button>
          )}
          {p.mentorship && state.role === "visitor" && (
            <Link to="/signin" className="btn btn-solid">
              Sign in to request mentorship
            </Link>
          )}
          {canContact && inApp && state.role !== "mentee" && (
            <button type="button" className="btn btn-outline" onClick={() => dispatch({ type: "toast", text: "Introduction requests arrive in a later phase." })}>
              Request an introduction
            </button>
          )}
          {isMentee && (
            <button type="button" className="btn btn-ghost" aria-pressed={saved} onClick={() => dispatch({ type: "toggleSaved", id: p.id })}>
              {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
              {saved ? "Saved" : "Save profile"}
            </button>
          )}
          {inApp && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReport(true)}>
              <Flag size={14} aria-hidden="true" />
              Report
            </button>
          )}
        </div>
      </header>

      <div className="pn-profile-body">
        <div>
          <section className="pn-section">
            <h2>About</h2>
            <p className="t-body measure-wide">{p.bio}</p>
          </section>
          <section className="pn-section">
            <h2>Expertise</h2>
            <div className="pn-tags">
              {p.expertise.map((e) => (
                <span key={e} className="pn-tag">
                  {e}
                </span>
              ))}
            </div>
            {p.interests.length > 0 && (
              <>
                <h3 className="t-small text-fg-2 mt-6 mb-2">Professional interests</h3>
                <p className="t-body">{p.interests.join(" · ")}</p>
              </>
            )}
          </section>
          {p.education.length > 0 && (
            <section className="pn-section">
              <h2>Education</h2>
              <ul className="pn-edu">
                {p.education.map((e) => (
                  <li key={`${e.degree}-${e.year}`} className="pn-edu-item">
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
          <section className="pn-section">
            <h2>Contact</h2>
            <p className="t-body text-fg-2 measure-wide">
              {p.hasLinkedIn && (
                <>
                  <Globe size={14} aria-hidden="true" className="inline mr-2 -mt-0.5" />
                  LinkedIn profile linked.{" "}
                </>
              )}
              {p.firstName} prefers to be reached through{" "}
              {p.contactMethods
                .filter((m) => m !== "mest")
                .map((m) => contactMethods.find((c) => c.id === m)?.label.toLowerCase())
                .join(", ") || "MEST requests"}
              . Personal details are shared only with members {p.firstName} accepts.
            </p>
          </section>
        </div>

        <aside>
          {p.mentorship ? (
            <Card title="Mentorship" aside={<Status tone={available ? "active" : p.mentorship.status === "paused" ? "paused" : "off"} label={available ? "Taking requests" : p.mentorship.status === "paused" ? "Paused" : "Full"} />} className="pn-mentor-panel">
              {p.mentorship.status === "paused" && p.mentorship.pausedUntil && (
                <p className="t-small text-fg-2 mb-4">Paused until {new Date(p.mentorship.pausedUntil).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.</p>
              )}
              <h3 className="t-small text-fg-2 mb-2">Can help with</h3>
              <ul className="grid gap-1.5 t-small">
                {p.mentorship.topics.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-accent" aria-hidden="true">
                      ·
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <dl className="pn-dl mt-5 t-small">
                <dt>For</dt>
                <dd>{p.mentorship.audience.map((a) => audiences.find((x) => x.id === a)?.label).join(", ")}</dd>
                <dt>Format</dt>
                <dd>
                  {p.mentorship.format === "either" ? "One-time or recurring" : p.mentorship.format === "one-time" ? "One-time guidance" : "Recurring mentoring"} ·{" "}
                  {p.mentorship.mode === "either" ? "online or in person" : p.mentorship.mode === "online" ? "online" : "in person"}
                </dd>
                <dt>Usually</dt>
                <dd>{p.mentorship.availability}</dd>
                <dt>Length</dt>
                <dd>{p.mentorship.duration} minutes</dd>
                <dt>Capacity</dt>
                <dd>
                  {activeCount} of {p.mentorship.maxActive} active mentees
                </dd>
              </dl>
              {isMentee && atCap && !existing && (
                <div className="mt-5">
                  <Notice tone="warn" icon={<Lock size={16} aria-hidden="true" />}>
                    You have {MAX_OPEN_REQUESTS} requests waiting. Withdraw one or wait for an answer before sending another.
                  </Notice>
                </div>
              )}
            </Card>
          ) : (
            <Card title="Mentorship" lift>
              <p className="t-small text-fg-2">
                {p.firstName} is listed for networking{p.participation.includes("speaking") ? " and speaking" : ""} and is not taking mentees.
              </p>
            </Card>
          )}
        </aside>
      </div>

      <Modal
        open={report}
        onClose={() => setReport(false)}
        title="Report this profile"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReport(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-solid btn-sm"
              disabled={!reason.trim()}
              onClick={() => {
                setReport(false);
                setReason("");
                dispatch({ type: "toast", text: "Thank you. An administrator will review this." });
                if (state.role === "admin") navigate("/admin/reports");
              }}
            >
              Send report
            </button>
          </>
        }
      >
        <p>Tell an administrator what is wrong. The member will not see who reported them.</p>
        <div className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inaccurate affiliation, promotional content, inappropriate behavior…" aria-label="Reason" />
        </div>
      </Modal>
    </div>
  );
}
