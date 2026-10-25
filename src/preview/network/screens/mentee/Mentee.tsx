import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, CalendarDays, Check, Clock, ExternalLink, Lock, Mail, MapPin, Video } from "lucide-react";
import { Link } from "../../router";
import { useStore, isMentorAvailable, isListed, openRequestCount, MAX_OPEN_REQUESTS, daysUntil, newId } from "../../state/store";
import { contactMethods, mentorshipTopics, type MentorshipTopic } from "../../data/taxonomy";
import { fullName, initials, TODAY } from "../../data/mock";
import type { MentorshipRequest, RequestStatus } from "../../data/types";
import { ProfileCard } from "../../components/directory";
import { Card, Empty, Field, fmtDate, fmtDateTime, fmtDayMonth, fmtRelative, fmtRelativeLower, Input, Modal, Monogram, Notice, Option, PageHead, Stat, Status, Steps, SwitchRow, Tabs, Textarea } from "../../components/ui";

/* ====================================================================
   9. Mentee dashboard
   ==================================================================== */

export function MenteeDashboard() {
  const { state, me } = useStore();
  const mine = state.requests.filter((r) => r.menteeId === me.mentee.id);
  const pending = mine.filter((r) => r.status === "pending");
  const accepted = mine.filter((r) => r.status === "accepted");
  const upcoming = state.meetings
    .filter((m) => m.status === "upcoming" && mine.some((r) => r.id === m.requestId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const saved = state.professionals.filter((p) => state.saved.includes(p.id) && isListed(p, state.role));

  // Suggested mentors: available, matching the student's topics, not already requested.
  const requestedIds = new Set(mine.filter((r) => r.status === "pending" || r.status === "accepted").map((r) => r.mentorId));
  const suggested = state.professionals
    .filter((p) => isListed(p, state.role) && isMentorAvailable(p, state.requests) && !requestedIds.has(p.id))
    .map((p) => ({ p, score: p.mentorship!.topics.filter((t) => me.mentee.topicsNeeded.includes(t)).length + (p.mentorship!.audience.includes(me.mentee.level) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.p);

  const nextAction = upcoming[0]
    ? { text: `Prepare for your meeting with ${mentorName(state, upcoming[0].requestId)} on ${fmtDate(upcoming[0].startsAt)}.`, to: `/me/requests/${upcoming[0].requestId}`, label: "See meeting details" }
    : accepted[0]
      ? { text: `${mentorName(state, accepted[0].id)} accepted your request. Arrange a time.`, to: `/me/requests/${accepted[0].id}`, label: "Arrange a meeting" }
      : pending.length
        ? { text: `You have ${pending.length} request${pending.length > 1 ? "s" : ""} waiting. Mentors have up to 14 days.`, to: "/me/requests", label: "Track requests" }
        : { text: "Find someone who has been where you are going.", to: "/me/discover", label: "Find a mentor" };

  return (
    <>
      <PageHead
        kicker={`Good to see you, ${me.mentee.firstName}`}
        title={<>Your mentorship, at a glance.</>}
        lead={me.mentee.goals}
        actions={
          <Link to="/me/discover" className="btn btn-solid">
            Find mentors
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        }
      />

      <div className="pn-stats mt-8">
        <Stat label="Open requests" value={pending.length} unit={`of ${MAX_OPEN_REQUESTS}`} />
        <Stat label="Mentors" value={accepted.length} note="accepted you" />
        <Stat label="Meetings" value={upcoming.length} note="coming up" />
        <Stat label="Saved" value={saved.length} note="profiles" />
      </div>

      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card accent title="Next step">
            <p className="t-lead">{nextAction.text}</p>
            <Link to={nextAction.to} className="btn btn-solid btn-sm mt-5">
              {nextAction.label}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Card>

          <Card title="Upcoming meetings" aside={<Link to="/me/requests" className="link link-quiet t-small">All requests</Link>}>
            {upcoming.length ? (
              upcoming.map((m) => <MeetingRow key={m.id} startsAt={m.startsAt} title={`With ${mentorName(state, m.requestId)}`} meta={`${m.durationMin} min · ${m.mode === "online" ? "Online" : "In person"} · ${m.place}`} to={`/me/requests/${m.requestId}`} />)
            ) : (
              <Empty inline title="Nothing scheduled.">
                When a mentor accepts, you arrange a time directly with them and it appears here.
              </Empty>
            )}
          </Card>

          <Card title="Requests" aside={<Link to="/me/requests" className="link link-quiet t-small">Track all</Link>} flush>
            <RequestList requests={mine.slice(0, 4)} />
          </Card>
        </div>

        <div className="grid gap-6">
          <Card title="Suggested for you" aside={<span className="t-small text-fg-2">From your topics</span>}>
            <ul className="pn-ledger">
              {suggested.map((p) => (
                <li key={p.id}>
                  <Link to={`/me/mentors/${p.id}`} className="pn-row-link">
                    <Monogram initials={initials(p)} size="sm" />
                    <span className="min-w-0">
                      <span className="pn-row-title block truncate">{fullName(p)}</span>
                      <span className="pn-row-meta block truncate">
                        {p.title} · {p.organization}
                      </span>
                    </span>
                    <ArrowUpRight size={16} aria-hidden="true" className="text-fg-2" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Saved" aside={<Link to="/me/saved" className="link link-quiet t-small">See all</Link>}>
            {saved.length ? (
              <ul className="grid gap-3">
                {saved.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <Monogram initials={initials(p)} size="sm" />
                    <Link to={`/me/mentors/${p.id}`} className="link link-quiet min-w-0 truncate">
                      {fullName(p)}
                    </Link>
                    {p.mentorship && <Status tone={isMentorAvailable(p, state.requests) ? "active" : "paused"} label={isMentorAvailable(p, state.requests) ? "Available" : "Unavailable"} className="ml-auto" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-small text-fg-2">Save profiles from the directory to come back to them.</p>
            )}
          </Card>

          <Card title="Recently" lift>
            <ul className="pn-timeline">
              {state.activity
                .filter((a) => a.text.includes(me.mentee.firstName))
                .slice(0, 4)
                .map((a) => (
                  <li key={a.id} className="pn-timeline-item">
                    <span className="pn-timeline-when">{fmtRelative(a.at, TODAY)}</span>
                    <span>{a.text}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function mentorName(state: ReturnType<typeof useStore>["state"], requestId: string) {
  const r = state.requests.find((x) => x.id === requestId);
  const p = r && state.professionals.find((x) => x.id === r.mentorId);
  return p ? fullName(p) : "your mentor";
}

export function MeetingRow({ startsAt, title, meta, to }: { startsAt: string; title: string; meta: string; to?: string }) {
  const { day, month } = fmtDayMonth(startsAt);
  const body = (
    <>
      <span className="pn-meeting-date">
        <b>{day}</b>
        <span>{month}</span>
      </span>
      <span className="min-w-0">
        <span className="pn-meeting-title block">{title}</span>
        <span className="pn-meeting-meta block">{fmtDateTime(startsAt).split(" · ")[1]} · {meta}</span>
      </span>
    </>
  );
  return to ? (
    <Link to={to} className="pn-meeting hover:text-accent">
      {body}
    </Link>
  ) : (
    <div className="pn-meeting">{body}</div>
  );
}

/* ====================================================================
   Request list (shared by dashboard and tracking)
   ==================================================================== */

function RequestList({ requests, empty }: { requests: MentorshipRequest[]; empty?: string }) {
  const { state } = useStore();
  if (!requests.length) {
    return (
      <div className="p-5">
        <Empty inline title={empty ?? "No requests yet."}>
          Requests you send appear here with their status.
        </Empty>
      </div>
    );
  }
  return (
    <ul>
      {requests.map((r) => {
        const p = state.professionals.find((x) => x.id === r.mentorId)!;
        return (
          <li key={r.id} className="border-b border-[var(--pn-line)] last:border-0">
            <Link to={`/me/requests/${r.id}`} className="pn-row-link !mx-0 !px-5 !rounded-none">
              <Monogram initials={initials(p)} size="sm" />
              <span className="min-w-0">
                <span className="pn-row-title block truncate">{fullName(p)}</span>
                <span className="pn-row-meta block truncate">
                  {r.topic} · {r.status === "pending" ? `expires in ${daysUntil(r.expiresAt)} days` : `${fmtRelativeLower(r.respondedAt ?? r.createdAt, TODAY)}`}
                </span>
              </span>
              <Status tone={r.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ====================================================================
   12–13. Send a mentorship request, confirmation
   ==================================================================== */

const REQUEST_STEPS = ["Topic", "Your message", "Format", "Review"];

export function RequestForm({ mentorId }: { mentorId: string }) {
  const { state, me, dispatch } = useStore();
  const p = state.professionals.find((x) => x.id === mentorId);
  const [step, setStep] = useState(0);
  const [sentId, setSentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    topic: "" as MentorshipTopic | "",
    why: "",
    goals: "",
    format: "one-time" as "one-time" | "recurring",
    mode: "online" as "online" | "in-person" | "either",
    schedulingNote: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!p || !p.mentorship) return <Empty title="This mentor is not available." />;
  const available = isMentorAvailable(p, state.requests);
  const atCap = openRequestCount(me.mentee.id, state.requests) >= MAX_OPEN_REQUESTS;

  if (sentId) {
    return (
      <div className="pn-wizard">
        <span className="pn-kicker">Request sent</span>
        <h1 className="mt-4">It is with {p.firstName} now.</h1>
        <p className="pn-wizard-lead">
          {p.firstName} has 14 days to respond and will see your profile and message. You will get an email with their
          answer. Nothing else happens until then; there is no need to follow up.
        </p>
        <div className="pn-wizard-body grid gap-5">
          <Card lift>
            <ol className="grid gap-4 t-small">
              {[
                ["Now", "Your request is pending. You can withdraw it any time."],
                ["Within 14 days", `${p.firstName} accepts or declines, with a short note.`],
                ["On accept", `You see how ${p.firstName} prefers to be reached and arrange a time directly.`],
              ].map(([k, v]) => (
                <li key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
                  <span className="text-accent">{k}</span>
                  <span className="text-fg-2">{v}</span>
                </li>
              ))}
            </ol>
          </Card>
          <div className="flex flex-wrap gap-4">
            <Link to={`/me/requests/${sentId}`} className="btn btn-solid">
              Track this request
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/me/discover" className="btn btn-outline">
              Back to mentors
            </Link>
          </div>
          <Notice>
            <strong>Prototype tip:</strong> switch to the Mentor view in the bar at the top to see this request arrive and accept it. Layla Haddad is the sample mentor, so send it to her to see the full loop.
          </Notice>
        </div>
      </div>
    );
  }

  if (!available || atCap) {
    return (
      <div className="pn-wizard">
        <Link to={`/me/mentors/${p.id}`} className="link link-quiet t-small">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to {p.firstName}'s profile
        </Link>
        <h1 className="mt-6">{atCap ? "You have three requests waiting." : `${p.firstName} is not taking requests right now.`}</h1>
        <p className="pn-wizard-lead">{atCap ? "Withdraw one or wait for an answer, then come back." : "Save the profile and check back, or find someone else who covers the same topic."}</p>
        <div className="mt-8 flex gap-4">
          <Link to={atCap ? "/me/requests" : "/me/discover"} className="btn btn-solid">
            {atCap ? "See my requests" : "Find other mentors"}
          </Link>
        </div>
      </div>
    );
  }

  const valid = [Boolean(form.topic), form.why.trim().length >= 30, true, true][step];

  const send = () => {
    const id = newId("req");
    dispatch({
      type: "sendRequest",
      id,
      request: {
        menteeId: me.mentee.id,
        mentorId: p.id,
        topic: form.topic as MentorshipTopic,
        why: form.why.trim(),
        goals: form.goals.trim(),
        format: form.format,
        mode: form.mode,
        schedulingNote: form.schedulingNote.trim(),
      },
    });
    setSentId(id);
  };

  return (
    <div className="pn-onboard">
      <div className="pn-wizard">
        <Link to={`/me/mentors/${p.id}`} className="link link-quiet t-small">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to {p.firstName}'s profile
        </Link>
        <div className="mt-6">
          <Steps steps={REQUEST_STEPS} current={step} />
        </div>

        {step === 0 && (
          <>
            <h1>What do you want to ask {p.firstName} about?</h1>
            <p className="pn-wizard-lead">These are the topics {p.firstName} offered. Pick the closest one.</p>
            <div className="pn-wizard-body pn-options" role="radiogroup">
              {p.mentorship.topics.map((t) => (
                <Option key={t} name="topic" checked={form.topic === t} title={t} onClick={() => set("topic", t)} />
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Say why.</h1>
            <p className="pn-wizard-lead">A few honest sentences. Mentors accept specific, prepared requests far more often than general ones.</p>
            <div className="pn-wizard-body pn-form">
              <Field label="Why you want to connect" hint={<span className="pn-counter block">{form.why.trim().length} characters, 30 minimum</span>}>
                {(id) => <Textarea id={id} value={form.why} onChange={(e) => set("why", e.target.value)} placeholder={`I am a junior in civil engineering applying for coastal internships, and your work on marsh restoration is exactly where I want to end up…`} />}
              </Field>
              <Field label="What would make this a success for you?" optional>
                {(id) => <Textarea id={id} value={form.goals} onChange={(e) => set("goals", e.target.value)} placeholder="A clearer idea of which firms to apply to, and feedback on my resume." style={{ minHeight: "5rem" }} />}
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>How would you like to meet?</h1>
            <p className="pn-wizard-lead">
              {p.firstName} offers {p.mentorship.format === "either" ? "one-time or recurring" : p.mentorship.format} conversations,{" "}
              {p.mentorship.mode === "either" ? "online or in person" : p.mentorship.mode}, usually {p.mentorship.duration} minutes. {p.mentorship.availability}.
            </p>
            <div className="pn-wizard-body pn-form">
              <fieldset className="pn-fieldset">
                <legend className="t-small">Format</legend>
                <div className="pn-options pn-options-2" role="radiogroup">
                  {(p.mentorship.format === "either" || p.mentorship.format === "one-time") && <Option name="format" checked={form.format === "one-time"} title="One conversation" note="A single focused session." onClick={() => set("format", "one-time")} />}
                  {(p.mentorship.format === "either" || p.mentorship.format === "recurring") && <Option name="format" checked={form.format === "recurring"} title="Recurring" note="A few sessions over time." onClick={() => set("format", "recurring")} />}
                </div>
              </fieldset>
              <fieldset className="pn-fieldset">
                <legend className="t-small">Where</legend>
                <div className="pn-options pn-options-2" role="radiogroup">
                  {(p.mentorship.mode === "either" || p.mentorship.mode === "online") && <Option name="mode" checked={form.mode === "online"} title="Online" onClick={() => set("mode", "online")} />}
                  {(p.mentorship.mode === "either" || p.mentorship.mode === "in-person") && <Option name="mode" checked={form.mode === "in-person"} title="In person" onClick={() => set("mode", "in-person")} />}
                  {p.mentorship.mode === "either" && <Option name="mode" checked={form.mode === "either"} title="Either works" onClick={() => set("mode", "either")} />}
                </div>
              </fieldset>
              <Field label="Scheduling preferences" optional hint="Days and times that work for you. The actual booking happens after acceptance.">
                {(id) => <Input id={id} value={form.schedulingNote} onChange={(e) => set("schedulingNote", e.target.value)} placeholder="Weekday evenings after 6 PM" />}
              </Field>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Review and send.</h1>
            <p className="pn-wizard-lead">{p.firstName} will see this along with your profile: your name, program, goals and topics.</p>
            <div className="pn-wizard-body grid gap-5">
              <Card flush>
                <dl className="pn-dl p-5 t-small">
                  <dt>To</dt>
                  <dd>{fullName(p, true)}</dd>
                  <dt>Topic</dt>
                  <dd>{form.topic}</dd>
                  <dt>Why</dt>
                  <dd>{form.why}</dd>
                  {form.goals && (
                    <>
                      <dt>Success</dt>
                      <dd>{form.goals}</dd>
                    </>
                  )}
                  <dt>Format</dt>
                  <dd>
                    {form.format === "one-time" ? "One conversation" : "Recurring"} · {form.mode === "either" ? "online or in person" : form.mode}
                  </dd>
                  {form.schedulingNote && (
                    <>
                      <dt>Times</dt>
                      <dd>{form.schedulingNote}</dd>
                    </>
                  )}
                </dl>
              </Card>
              <Notice icon={<Lock size={16} aria-hidden="true" />}>
                Your email and phone are not included. If {p.firstName} accepts, you will see their preferred way to be reached.
              </Notice>
            </div>
          </>
        )}

        <div className="pn-wizard-foot">
          <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          {step < 3 ? (
            <button type="button" className="btn btn-solid" disabled={!valid} onClick={() => setStep((s) => s + 1)}>
              Continue
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="btn btn-solid" onClick={send}>
              Send request
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <aside className="pn-wizard-aside">
        <Card lift>
          <div className="flex items-center gap-3">
            <Monogram initials={initials(p)} />
            <div className="min-w-0">
              <div className="pn-row-title truncate">{fullName(p, true)}</div>
              <div className="pn-row-meta truncate">{p.title}</div>
            </div>
          </div>
          <dl className="pn-dl mt-5 t-small">
            <dt>Usually</dt>
            <dd>{p.mentorship.availability}</dd>
            <dt>Length</dt>
            <dd>{p.mentorship.duration} minutes</dd>
            <dt>Responds</dt>
            <dd>Within 14 days</dd>
          </dl>
        </Card>
      </aside>
    </div>
  );
}

/* ====================================================================
   14. Request tracking
   ==================================================================== */

type TrackTab = "active" | "pending" | "accepted" | "closed";

export function MenteeRequests() {
  const { state, me } = useStore();
  const [tab, setTab] = useState<TrackTab>("active");
  const mine = state.requests.filter((r) => r.menteeId === me.mentee.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed: RequestStatus[] = ["declined", "completed", "canceled", "expired"];
  const groups: Record<TrackTab, MentorshipRequest[]> = {
    active: mine.filter((r) => r.status === "pending" || r.status === "accepted"),
    pending: mine.filter((r) => r.status === "pending"),
    accepted: mine.filter((r) => r.status === "accepted"),
    closed: mine.filter((r) => closed.includes(r.status)),
  };
  return (
    <>
      <PageHead kicker="My requests" title="Where each request stands." lead={`You can have ${MAX_OPEN_REQUESTS} requests waiting at once. Pending requests expire after 14 days if a mentor does not respond.`} />
      <div className="mt-8">
        <Tabs
          label="Request status"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "active", label: "Active", count: groups.active.length },
            { id: "pending", label: "Pending", count: groups.pending.length },
            { id: "accepted", label: "Accepted", count: groups.accepted.length },
            { id: "closed", label: "Closed", count: groups.closed.length },
          ]}
        />
      </div>
      <Card flush className="mt-6">
        <RequestList requests={groups[tab]} empty={tab === "closed" ? "Nothing closed yet." : "Nothing here."} />
      </Card>
    </>
  );
}

/* ====================================================================
   15. Request detail: accepted relationship and meeting details
   ==================================================================== */

export function MenteeRequestDetail({ id }: { id: string }) {
  const { state, me, dispatch } = useStore();
  const r = state.requests.find((x) => x.id === id && x.menteeId === me.mentee.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!r) return <Empty title="Request not found." />;
  const p = state.professionals.find((x) => x.id === r.mentorId)!;
  const meetings = state.meetings.filter((m) => m.requestId === r.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcoming = meetings.filter((m) => m.status === "upcoming");
  const past = meetings.filter((m) => m.status === "completed");

  return (
    <>
      <Link to="/me/requests" className="link link-quiet t-small">
        <ArrowLeft size={14} aria-hidden="true" />
        All requests
      </Link>
      <header className="pn-page-head mt-4">
        <div className="flex items-start gap-5">
          <Monogram initials={initials(p)} size="lg" />
          <div>
            <Status tone={r.status} pill />
            <h1 className="mt-3">{fullName(p, true)}</h1>
            <p>
              {r.topic} · sent {fmtRelativeLower(r.createdAt, TODAY)}
              {r.status === "pending" && ` · expires in ${daysUntil(r.expiresAt)} days`}
            </p>
          </div>
        </div>
        <div className="pn-page-actions">
          <Link to={`/me/mentors/${p.id}`} className="btn btn-outline btn-sm">
            View profile
          </Link>
          {r.status === "pending" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(true)}>
              Withdraw
            </button>
          )}
        </div>
      </header>

      <div className="pn-split mt-8">
        <div className="grid gap-6">
          {r.status === "accepted" && (
            <Card accent title="Next step: arrange a time">
              <p className="t-body">
                {p.firstName} accepted and prefers to be reached this way. Suggest a time within their usual availability:{" "}
                <span className="text-fg">{p.mentorship?.availability}</span>.
              </p>
              <div className="grid gap-3 mt-5">
                {p.contactMethods.filter((m) => m !== "mest").map((m) => (
                  <ContactReveal key={m} method={m} p={p} />
                ))}
                {p.contactMethods.length === 1 && (
                  <Notice icon={<Mail size={16} aria-hidden="true" />}>
                    {p.firstName} prefers to coordinate through MEST. Reply from your email notification and we relay it.
                  </Notice>
                )}
              </div>
            </Card>
          )}

          {r.status === "pending" && (
            <Card lift>
              <div className="flex gap-4">
                <Clock size={20} aria-hidden="true" className="text-accent shrink-0 mt-0.5" />
                <div>
                  <p className="t-body">Waiting on {p.firstName}. Mentors get a reminder at day 5 and day 10; the request expires on {fmtDate(r.expiresAt)} if unanswered, and you can send another.</p>
                </div>
              </div>
            </Card>
          )}

          {r.status === "declined" && (
            <Card lift>
              <p className="t-body">
                {p.firstName} could not take this one{r.declineReason ? ` (${r.declineReason.toLowerCase()})` : ""}. Their note is below. This does not count against your open requests.
              </p>
              <Link to="/me/discover" className="btn btn-outline btn-sm mt-4">
                Find another mentor
              </Link>
            </Card>
          )}

          <Card title="Your request" flush>
            <div className="pn-thread p-5">
              <div className="pn-msg">
                <Monogram initials={initials(me.mentee)} size="sm" student />
                <div className="min-w-0">
                  <div className="pn-msg-head">
                    <strong>You</strong>
                    <span>{fmtDate(r.createdAt)}</span>
                  </div>
                  <p>{r.why}</p>
                  {r.goals && (
                    <p className="text-fg-2">
                      <span className="text-fg">Success looks like:</span> {r.goals}
                    </p>
                  )}
                  <p className="text-fg-2 t-small">
                    {r.format === "one-time" ? "One conversation" : "Recurring"} · {r.mode === "either" ? "online or in person" : r.mode}
                    {r.schedulingNote && ` · ${r.schedulingNote}`}
                  </p>
                </div>
              </div>
              {r.mentorNote && (
                <div className="pn-msg pn-msg-mentor">
                  <Monogram initials={initials(p)} size="sm" />
                  <div className="min-w-0">
                    <div className="pn-msg-head">
                      <strong>{fullName(p)}</strong>
                      <span>{r.respondedAt && fmtDate(r.respondedAt)}</span>
                    </div>
                    <p>{r.mentorNote}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-6">
          {(r.status === "accepted" || r.status === "completed") && (
            <Card title="Meetings">
              {upcoming.length ? upcoming.map((m) => <MeetingRow key={m.id} startsAt={m.startsAt} title={m.agenda} meta={`${m.durationMin} min · ${m.place}`} />) : <p className="t-small text-fg-2">No meeting scheduled yet. Once you agree a time with {p.firstName}, either of you can add it here so both get a reminder.</p>}
              {past.length > 0 && (
                <>
                  <h3 className="t-small text-fg-2 mt-5 mb-1">Past</h3>
                  {past.map((m) => (
                    <MeetingRow key={m.id} startsAt={m.startsAt} title={m.agenda} meta={`${m.durationMin} min · ${m.place}`} />
                  ))}
                </>
              )}
              {r.status === "accepted" && (
                <button type="button" className="btn btn-outline btn-sm mt-5" onClick={() => dispatch({ type: "completeRequest", id: r.id })}>
                  <Check size={15} aria-hidden="true" />
                  Mark as complete
                </button>
              )}
            </Card>
          )}
          <Card title="Timeline" lift>
            <ul className="pn-timeline">
              <li className="pn-timeline-item">
                <span className="pn-timeline-when">{fmtDate(r.createdAt)}</span>
                <span>Request sent</span>
              </li>
              {r.respondedAt && (
                <li className="pn-timeline-item">
                  <span className="pn-timeline-when">{fmtDate(r.respondedAt)}</span>
                  <span>{r.status === "canceled" ? "You withdrew the request" : `${p.firstName} ${r.status === "declined" ? "declined" : "accepted"}`}</span>
                </li>
              )}
              {meetings.map((m) => (
                <li key={m.id} className="pn-timeline-item">
                  <span className="pn-timeline-when">{fmtDate(m.startsAt)}</span>
                  <span>
                    Meeting {m.status === "completed" ? "held" : "scheduled"}: {m.agenda}
                  </span>
                </li>
              ))}
              {r.status === "completed" && (
                <li className="pn-timeline-item">
                  <span className="pn-timeline-when">—</span>
                  <span>Marked complete</span>
                </li>
              )}
              {r.status === "expired" && (
                <li className="pn-timeline-item">
                  <span className="pn-timeline-when">{fmtDate(r.expiresAt)}</span>
                  <span>Expired without a response</span>
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Withdraw this request?"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => { dispatch({ type: "cancelRequest", id: r.id }); setConfirmCancel(false); }}>
              Withdraw
            </button>
          </>
        }
      >
        <p>{p.firstName} will no longer see it. You can send a new request later.</p>
      </Modal>
    </>
  );
}

function ContactReveal({ method, p }: { method: string; p: { firstName: string; lastName: string; hasBookingLink: boolean } }) {
  const def = contactMethods.find((c) => c.id === method);
  const icon = method === "booking" ? <CalendarDays size={16} aria-hidden="true" /> : method === "email" ? <Mail size={16} aria-hidden="true" /> : method === "linkedin" ? <ExternalLink size={16} aria-hidden="true" /> : method === "phone" ? <Video size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />;
  const value =
    method === "booking" ? `cal.example/${p.firstName.toLowerCase()}` : method === "email" ? `${p.firstName.toLowerCase()}@example.com` : method === "linkedin" ? `linkedin.com/in/${p.firstName.toLowerCase()}-${p.lastName.toLowerCase()}` : "(504) 555-0100";
  return (
    <div className="pn-notice" data-tone="ok">
      {icon}
      <div className="min-w-0">
        <strong>{def?.label}</strong>
        <div className="truncate">{value}</div>
        <div className="t-small">Sample value. Revealed only because {p.firstName} accepted.</div>
      </div>
    </div>
  );
}

/* ====================================================================
   Saved professionals
   ==================================================================== */

export function MenteeSaved() {
  const { state } = useStore();
  const saved = state.professionals.filter((p) => state.saved.includes(p.id) && isListed(p, state.role));
  return (
    <>
      <PageHead kicker="Saved" title="People you want to come back to." lead="Saved profiles are private to you. Mentors are not told." />
      {saved.length ? (
        <div className="pn-cards mt-8">
          {saved.map((p) => (
            <ProfileCard key={p.id} p={p} to={`/me/mentors/${p.id}`} />
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <Empty title="Nothing saved yet." action={<Link to="/me/discover" className="btn btn-outline btn-sm">Browse mentors</Link>}>
            <Bookmark size={14} aria-hidden="true" className="inline -mt-0.5 mr-1" /> Use the bookmark on any profile.
          </Empty>
        </div>
      )}
    </>
  );
}

/* ====================================================================
   Mentee profile and privacy settings
   ==================================================================== */

export function MenteeSettings() {
  const { me, state, dispatch } = useStore();
  const [topics, setTopics] = useState<MentorshipTopic[]>(me.mentee.topicsNeeded);
  const [goals, setGoals] = useState(me.mentee.goals);
  return (
    <>
      <PageHead kicker="Profile & privacy" title="What mentors see about you." lead="Students are never listed in the directory. This profile travels with your requests." />
      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Your profile">
            <div className="pn-form">
              <div className="flex items-center gap-4">
                <Monogram initials={initials(me.mentee)} size="lg" student />
                <div>
                  <div className="pn-row-title">{fullName(me.mentee)}</div>
                  <div className="pn-row-meta">
                    {me.mentee.program} · {me.mentee.institution}
                  </div>
                </div>
              </div>
              <Field label="What you are working toward" privacy="members">
                {(id) => <Textarea id={id} value={goals} onChange={(e) => setGoals(e.target.value)} />}
              </Field>
              <fieldset className="pn-fieldset">
                <legend className="t-small">Topics you want help with</legend>
                <div className="pn-chips">
                  {mentorshipTopics.map((t) => (
                    <button key={t} type="button" className="pn-chip" aria-pressed={topics.includes(t)} onClick={() => setTopics((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))}>
                      {t}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div>
                <button type="button" className="btn btn-solid btn-sm" onClick={() => dispatch({ type: "toast", text: "Profile saved." })}>
                  Save changes
                </button>
              </div>
            </div>
          </Card>
          <Card title="Notifications" flush className="px-5">
            <SwitchRow title="A mentor responds to my request" note="Email, once per response." checked={state.notificationPrefs.newRequestEmail} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { newRequestEmail: v } })} />
            <SwitchRow title="Meeting reminders" note="The day before a meeting that has been added here." checked={state.notificationPrefs.meetingReminders} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { meetingReminders: v } })} />
            <SwitchRow title="Monthly digest" note="New mentors in your topics and upcoming MEST events." checked={state.notificationPrefs.weeklyDigest} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { weeklyDigest: v } })} />
          </Card>
        </div>
        <div className="grid gap-6">
          <Card title="Privacy" lift>
            <ul className="grid gap-3 t-small text-fg-2">
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Your email is used to sign in and is never shown to mentors.
              </li>
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Mentors see your profile only when you send them a request.
              </li>
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Nobody sees which other mentors you have requested.
              </li>
            </ul>
          </Card>
          <Card title="Account">
            <p className="t-small text-fg-2">Download everything we hold about you, or delete your account. Deletion hides your profile immediately and removes your data after 14 days.</p>
            <div className="flex flex-wrap gap-3 mt-4">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => dispatch({ type: "toast", text: "In the real build this emails you an export." })}>
                Export my data
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => dispatch({ type: "toast", text: "Deletion is simulated here; nothing happened." })}>
                Delete account
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
