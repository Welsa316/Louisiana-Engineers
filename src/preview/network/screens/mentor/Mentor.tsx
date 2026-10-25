import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarPlus, Check, Clock, Pause, Play, X } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useStore, activeMenteeCount, daysUntil, isMentorAvailable } from "../../state/store";
import { audiences, contactMethods, disciplines, disciplineGroups, mentorshipTopics, participationOptions, type AudienceId, type ContactMethodId, type MentorshipTopic, type ParticipationId } from "../../data/taxonomy";
import { fullName, initials, TODAY } from "../../data/mock";
import type { MentorshipRequest, Student } from "../../data/types";
import { MeetingRow } from "../mentee/Mentee";
import { Card, Chip, Drawer, Empty, Field, fmtDate, fmtRelative, fmtRelativeLower, Input, Modal, Monogram, Notice, Option, PageHead, Select, Stat, Status, SwitchRow, Tabs, Textarea } from "../../components/ui";

/* ====================================================================
   16. Mentor dashboard
   ==================================================================== */

export function MentorDashboard() {
  const { state, me, dispatch } = useStore();
  const m = me.mentor;
  const mine = state.requests.filter((r) => r.mentorId === m.id);
  const pending = mine.filter((r) => r.status === "pending").sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const active = mine.filter((r) => r.status === "accepted");
  const completed = mine.filter((r) => r.status === "completed");
  const upcoming = state.meetings.filter((mt) => mt.status === "upcoming" && mine.some((r) => r.id === mt.requestId)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const paused = m.mentorship?.status === "paused";
  const cap = m.mentorship?.maxActive ?? 0;

  return (
    <>
      <PageHead
        kicker={`Welcome back, ${m.firstName}`}
        title={pending.length ? <>{pending.length} {pending.length === 1 ? "person is" : "people are"} waiting to hear from you.</> : <>All caught up.</>}
        lead={paused ? "Mentorship is paused. Your profile is listed, but nobody can send you a request until you resume." : `You are taking ${active.length} of ${cap} mentees. Requests expire after 14 days, so nothing piles up.`}
        actions={
          <button type="button" className={paused ? "btn btn-solid" : "btn btn-outline"} onClick={() => dispatch({ type: "updateMentorship", id: m.id, settings: { status: paused ? "active" : "paused", pausedUntil: undefined } })}>
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            {paused ? "Resume mentorship" : "Pause mentorship"}
          </button>
        }
      />

      <div className="pn-stats mt-8">
        <Stat label="Waiting" value={pending.length} note={pending[0] ? `oldest expires in ${daysUntil(pending[0].expiresAt)} days` : "nothing pending"} />
        <Stat label="Active mentees" value={active.length} unit={`of ${cap}`} />
        <Stat label="Upcoming" value={upcoming.length} note="meetings" />
        <Stat label="Helped" value={completed.length + active.length} note="people so far" />
      </div>

      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Incoming requests" aside={<Link to="/mentor/requests" className="link link-quiet t-small">All requests</Link>} flush>
            {pending.length ? (
              <ul>
                {pending.map((r) => (
                  <IncomingRow key={r.id} r={r} />
                ))}
              </ul>
            ) : (
              <div className="p-5">
                <Empty inline title="No requests waiting.">You will get one email when someone writes, and a reminder if it sits for five days.</Empty>
              </div>
            )}
          </Card>

          <Card title="Upcoming meetings" aside={<Link to="/mentor/mentees" className="link link-quiet t-small">Mentees</Link>}>
            {upcoming.length ? (
              upcoming.map((mt) => {
                const r = mine.find((x) => x.id === mt.requestId)!;
                const s = state.students.find((x) => x.id === r.menteeId)!;
                return <MeetingRow key={mt.id} startsAt={mt.startsAt} title={`${fullName(s)} · ${mt.agenda}`} meta={`${mt.durationMin} min · ${mt.place}`} to={`/mentor/mentees/${r.id}`} />;
              })
            ) : (
              <p className="t-small text-fg-2">Nothing scheduled. Meetings added by you or a mentee appear here with a reminder the day before.</p>
            )}
          </Card>
        </div>

        <div className="grid gap-6">
          <Card title="Your mentorship profile" aside={<Status tone={isMentorAvailable(m, state.requests) ? "active" : paused ? "paused" : "off"} label={isMentorAvailable(m, state.requests) ? "Taking requests" : paused ? "Paused" : "Full"} />}>
            <dl className="pn-dl t-small">
              <dt>Topics</dt>
              <dd>{m.mentorship?.topics.join(", ")}</dd>
              <dt>Usually</dt>
              <dd>{m.mentorship?.availability}</dd>
              <dt>Cap</dt>
              <dd>{cap} active mentees</dd>
            </dl>
            <div className="flex flex-wrap gap-3 mt-5">
              <Link to="/mentor/availability" className="btn btn-outline btn-sm">
                Availability
              </Link>
              <Link to="/mentor/profile" className="btn btn-ghost btn-sm">
                Edit profile
              </Link>
            </div>
          </Card>
          <Card title="Recently" lift>
            <ul className="pn-timeline">
              {state.activity
                .filter((a) => a.text.includes(m.lastName))
                .slice(0, 5)
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

function IncomingRow({ r }: { r: MentorshipRequest }) {
  const { state } = useStore();
  const s = state.students.find((x) => x.id === r.menteeId)!;
  const days = daysUntil(r.expiresAt);
  return (
    <li className="border-b border-[var(--pn-line)] last:border-0">
      <Link to={`/mentor/requests/${r.id}`} className="pn-row-link !mx-0 !px-5 !rounded-none">
        <Monogram initials={initials(s)} size="sm" student />
        <span className="min-w-0">
          <span className="pn-row-title block truncate">{fullName(s)}</span>
          <span className="pn-row-meta block truncate">
            {r.topic} · {s.program}
          </span>
        </span>
        <span className="pn-status" data-tone={days <= 4 ? "pending" : "expired"}>
          <Clock size={13} aria-hidden="true" />
          {days} days left
        </span>
      </Link>
    </li>
  );
}

/* ====================================================================
   17–18. Incoming requests, details and accept/decline
   ==================================================================== */

type MentorTab = "pending" | "accepted" | "closed";

export function MentorRequests({ selectedId }: { selectedId?: string }) {
  const { state, me } = useStore();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<MentorTab>("pending");
  const mine = state.requests.filter((r) => r.mentorId === me.mentor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: Record<MentorTab, MentorshipRequest[]> = {
    pending: mine.filter((r) => r.status === "pending"),
    accepted: mine.filter((r) => r.status === "accepted"),
    closed: mine.filter((r) => !["pending", "accepted"].includes(r.status)),
  };
  const selected = selectedId ? mine.find((r) => r.id === selectedId) : undefined;

  return (
    <>
      <PageHead kicker="Requests" title="People who asked for your time." lead="Each request shows the student's profile and message. Accepting shares the contact methods you chose; declining sends your note and nothing else." />
      <div className="mt-8">
        <Tabs
          label="Request status"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "pending", label: "Waiting", count: groups.pending.length },
            { id: "accepted", label: "Accepted", count: groups.accepted.length },
            { id: "closed", label: "Closed", count: groups.closed.length },
          ]}
        />
      </div>
      <Card flush className="mt-6">
        {groups[tab].length ? (
          <ul>
            {groups[tab].map((r) => {
              const s = state.students.find((x) => x.id === r.menteeId)!;
              return (
                <li key={r.id} className="border-b border-[var(--pn-line)] last:border-0">
                  <Link to={`/mentor/requests/${r.id}`} className="pn-row-link !mx-0 !px-5 !rounded-none">
                    <Monogram initials={initials(s)} size="sm" student />
                    <span className="min-w-0">
                      <span className="pn-row-title block truncate">{fullName(s)}</span>
                      <span className="pn-row-meta block truncate">
                        {r.topic} · {r.status === "pending" ? `${daysUntil(r.expiresAt)} days left` : fmtRelativeLower(r.respondedAt ?? r.createdAt, TODAY)}
                      </span>
                    </span>
                    <Status tone={r.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-5">
            <Empty inline title={tab === "pending" ? "Nothing waiting." : "Nothing here yet."}>{tab === "pending" ? "New requests arrive by email and appear here." : ""}</Empty>
          </div>
        )}
      </Card>

      <RequestDrawer r={selected} onClose={() => navigate("/mentor/requests")} />
    </>
  );
}

function RequestDrawer({ r, onClose }: { r?: MentorshipRequest; onClose: () => void }) {
  const { state, me, dispatch } = useStore();
  const [mode, setMode] = useState<"view" | "accept" | "decline">("view");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("Not the right fit for this topic");
  const s = r && state.students.find((x) => x.id === r.menteeId);
  const atCap = activeMenteeCount(me.mentor.id, state.requests) >= (me.mentor.mentorship?.maxActive ?? 0);

  const close = () => {
    setMode("view");
    setNote("");
    onClose();
  };
  const respond = (decision: "accepted" | "declined") => {
    if (!r) return;
    dispatch({ type: "respond", id: r.id, decision, note: note.trim() || (decision === "accepted" ? "Happy to help. Pick a time from my scheduling link and we will take it from there." : "Thank you for reaching out. I am not able to take this on right now."), reason: decision === "declined" ? reason : undefined });
    close();
  };

  return (
    <Drawer
      open={Boolean(r)}
      onClose={close}
      title={s ? fullName(s) : ""}
      footer={
        r && s && r.status === "pending" ? (
          mode === "view" ? (
            <>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode("decline")}>
                <X size={15} aria-hidden="true" />
                Decline
              </button>
              <button type="button" className="btn btn-solid btn-sm" onClick={() => setMode("accept")} disabled={atCap} title={atCap ? "You are at your mentee cap" : undefined}>
                <Check size={15} aria-hidden="true" />
                Accept
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("view")}>
                Back
              </button>
              <button type="button" className={mode === "accept" ? "btn btn-solid btn-sm" : "btn btn-danger btn-sm"} onClick={() => respond(mode === "accept" ? "accepted" : "declined")}>
                {mode === "accept" ? "Accept and share contact" : "Send decline"}
              </button>
            </>
          )
        ) : r && r.status === "accepted" ? (
          <Link to={`/mentor/mentees/${r.id}`} className="btn btn-solid btn-sm">
            Open relationship
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      {r && s && (
        <div className="grid gap-6">
          <div className="flex items-start gap-4">
            <Monogram initials={initials(s)} size="lg" student />
            <div className="min-w-0">
              <Status tone={r.status} pill />
              <div className="pn-row-title mt-2">{s.program}</div>
              <div className="pn-row-meta">
                {s.institution} · {s.location}
              </div>
            </div>
          </div>

          {mode === "view" && (
            <>
              {r.status === "pending" && (
                <Notice icon={<Clock size={16} aria-hidden="true" />}>
                  Sent {fmtRelativeLower(r.createdAt, TODAY)}. Expires {fmtDate(r.expiresAt)} if you do nothing.
                </Notice>
              )}
              {atCap && r.status === "pending" && (
                <Notice tone="warn" icon={<Clock size={16} aria-hidden="true" />}>
                  You are at your cap of {me.mentor.mentorship?.maxActive} active mentees. Complete one, or raise the cap under Availability, to accept.
                </Notice>
              )}
              <section>
                <h3 className="pn-kicker pn-kicker-plain mb-3">Asking about</h3>
                <p className="t-heading">{r.topic}</p>
                <p className="t-small text-fg-2 mt-1">
                  {r.format === "one-time" ? "One conversation" : "Recurring"} · {r.mode === "either" ? "online or in person" : r.mode}
                  {r.schedulingNote && ` · ${r.schedulingNote}`}
                </p>
              </section>
              <section>
                <h3 className="pn-kicker pn-kicker-plain mb-3">Their message</h3>
                <p className="t-body">{r.why}</p>
                {r.goals && (
                  <p className="t-body text-fg-2 mt-3">
                    <span className="text-fg">Success looks like:</span> {r.goals}
                  </p>
                )}
              </section>
              <section>
                <h3 className="pn-kicker pn-kicker-plain mb-3">About {s.firstName}</h3>
                <p className="t-small">{s.goals}</p>
                <div className="pn-tags mt-3">
                  {s.interests.map((i) => (
                    <span key={i} className="pn-tag pn-tag-quiet">
                      {i}
                    </span>
                  ))}
                </div>
              </section>
              {r.mentorNote && (
                <section>
                  <h3 className="pn-kicker pn-kicker-plain mb-3">Your note</h3>
                  <p className="t-body text-fg-2">{r.mentorNote}</p>
                </section>
              )}
            </>
          )}

          {mode === "accept" && (
            <div className="grid gap-5">
              <p className="t-body">
                {s.firstName} will see the contact methods you chose ({me.mentor.contactMethods.filter((c) => c !== "mest").map((c) => contactMethods.find((x) => x.id === c)?.label.toLowerCase()).join(", ") || "MEST relay"}) and your note.
              </p>
              <Field label="A short note" hint="Suggest how to start: pick a slot, send a resume ahead, come by the office.">
                {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Happy to help. Pick a time from my scheduling link and send your resume the day before." />}
              </Field>
            </div>
          )}

          {mode === "decline" && (
            <div className="grid gap-5">
              <p className="t-body">{s.firstName} sees your reason and note, nothing else. A kind decline with a pointer to someone else is worth a lot.</p>
              <Field label="Reason">
                {(id) => (
                  <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
                    {["Not the right fit for this topic", "No capacity right now", "Outside my experience", "Other"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Note to the student" optional>
                {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="This is closer to what Samira Benali does; I would try her." />}
              </Field>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ====================================================================
   19. Manage availability
   ==================================================================== */

export function MentorAvailability() {
  const { me, state, dispatch } = useStore();
  const m = me.mentor;
  const ms = m.mentorship!;
  const [draft, setDraft] = useState({ ...ms });
  const [pauseUntil, setPauseUntil] = useState(ms.pausedUntil ?? "");
  const active = activeMenteeCount(m.id, state.requests);
  const changed = JSON.stringify(draft) !== JSON.stringify(ms);

  const toggleTopic = (t: MentorshipTopic) => setDraft((d) => ({ ...d, topics: d.topics.includes(t) ? d.topics.filter((x) => x !== t) : [...d.topics, t] }));
  const toggleAudience = (a: AudienceId) => setDraft((d) => ({ ...d, audience: d.audience.includes(a) ? d.audience.filter((x) => x !== a) : [...d.audience, a] }));

  return (
    <>
      <PageHead kicker="Availability" title="Your time, your rules." lead="Changes apply immediately. Nothing here affects requests you have already accepted." />
      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Status" aside={<Status tone={ms.status === "paused" ? "paused" : active >= ms.maxActive ? "off" : "active"} label={ms.status === "paused" ? "Paused" : active >= ms.maxActive ? "Full" : "Taking requests"} />}>
            <div className="pn-options">
              <Option checked={draft.status === "active"} title="Taking requests" note="Students who match your topics and audience can send you a request." onClick={() => setDraft((d) => ({ ...d, status: "active", pausedUntil: undefined }))} />
              <Option checked={draft.status === "paused"} title="Paused" note="Your profile stays listed; the request button is replaced with a paused notice. Set a date or leave it open." onClick={() => setDraft((d) => ({ ...d, status: "paused" }))} />
            </div>
            {draft.status === "paused" && (
              <div className="mt-4 max-w-xs">
                <Field label="Resume on" optional hint="We switch you back on that morning and email you.">
                  {(id) => <Input id={id} type="date" value={pauseUntil} onChange={(e) => { setPauseUntil(e.target.value); setDraft((d) => ({ ...d, pausedUntil: e.target.value || undefined })); }} />}
                </Field>
              </div>
            )}
          </Card>

          <Card title="Capacity">
            <div className="pn-form pn-form-2">
              <Field label="Active mentees at once" hint={`You currently have ${active}. Lowering the cap below that does not drop anyone.`}>
                {(id) => <Input id={id} type="number" min={1} max={10} inputMode="numeric" value={draft.maxActive} onChange={(e) => setDraft((d) => ({ ...d, maxActive: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))} />}
              </Field>
              <Field label="Usual meeting length">
                {(id) => (
                  <Select id={id} value={String(draft.duration)} onChange={(e) => setDraft((d) => ({ ...d, duration: Number(e.target.value) as 30 | 45 | 60 }))}>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                  </Select>
                )}
              </Field>
              <Field label="General availability" className="pn-form-span" hint="Shown on your profile. Free text; this is not a calendar.">
                {(id) => <Input id={id} value={draft.availability} onChange={(e) => setDraft((d) => ({ ...d, availability: e.target.value }))} />}
              </Field>
            </div>
          </Card>

          <Card title="What you offer">
            <div className="pn-form">
              <fieldset className="pn-fieldset">
                <legend className="t-small">Topics</legend>
                <div className="pn-chips">
                  {mentorshipTopics.map((t) => (
                    <Chip key={t} pressed={draft.topics.includes(t)} onClick={() => toggleTopic(t)}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset className="pn-fieldset">
                <legend className="t-small">Audience</legend>
                <div className="pn-chips">
                  {audiences.map((a) => (
                    <Chip key={a.id} pressed={draft.audience.includes(a.id)} onClick={() => toggleAudience(a.id)}>
                      {a.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <div className="pn-form pn-form-2">
                <Field label="Format">
                  {(id) => (
                    <Select id={id} value={draft.format} onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value as typeof d.format }))}>
                      <option value="one-time">One-time guidance</option>
                      <option value="recurring">Recurring mentoring</option>
                      <option value="either">Either</option>
                    </Select>
                  )}
                </Field>
                <Field label="Where">
                  {(id) => (
                    <Select id={id} value={draft.mode} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as typeof d.mode }))}>
                      <option value="online">Online</option>
                      <option value="in-person">In person</option>
                      <option value="either">Either</option>
                    </Select>
                  )}
                </Field>
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-solid" disabled={!changed || draft.topics.length === 0} onClick={() => dispatch({ type: "updateMentorship", id: m.id, settings: draft })}>
              Save changes
            </button>
            <button type="button" className="btn btn-ghost" disabled={!changed} onClick={() => { setDraft({ ...ms }); setPauseUntil(ms.pausedUntil ?? ""); }}>
              Discard
            </button>
          </div>
        </div>

        <div className="grid gap-6">
          <Card title="How this shows up" lift>
            <ul className="grid gap-3 t-small text-fg-2">
              <li>
                <span className="text-fg">Paused</span>: profile listed, request button replaced with "Mentorship paused" and your resume date if set.
              </li>
              <li>
                <span className="text-fg">Full</span>: shown automatically when accepted mentees reach your cap. Clears when you mark one complete.
              </li>
              <li>
                <span className="text-fg">Topics and audience</span>: students outside them cannot pick you in the request form.
              </li>
            </ul>
          </Card>
          <Card title="Later: time slots">
            <p className="t-small text-fg-2">A lightweight "propose three times" step and a shared meeting log are planned for a later phase. External scheduling links cover the first release.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ====================================================================
   20. Manage mentees (accepted relationships)
   ==================================================================== */

export function MentorMentees({ selectedId }: { selectedId?: string }) {
  const { state, me, dispatch } = useStore();
  const { navigate } = useRouter();
  const mine = state.requests.filter((r) => r.mentorId === me.mentor.id && (r.status === "accepted" || r.status === "completed"));
  const active = mine.filter((r) => r.status === "accepted");
  const done = mine.filter((r) => r.status === "completed");
  const selected = selectedId ? mine.find((r) => r.id === selectedId) : undefined;

  if (selected) {
    return <Relationship r={selected} />;
  }

  return (
    <>
      <PageHead kicker="Mentees" title="People you said yes to." lead="Add meetings so both of you get a reminder, and mark a relationship complete when it has run its course. That frees a slot." />
      <div className="mt-8 grid gap-8">
        <section>
          <h2 className="t-label text-accent mb-4">Active · {active.length}</h2>
          {active.length ? (
            <div className="pn-grid pn-grid-2">
              {active.map((r) => {
                const s = state.students.find((x) => x.id === r.menteeId)!;
                const next = state.meetings.filter((m) => m.requestId === r.id && m.status === "upcoming").sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
                return (
                  <Card key={r.id} as="article">
                    <div className="flex items-start gap-4">
                      <Monogram initials={initials(s)} student />
                      <div className="min-w-0 flex-1">
                        <h3 className="pn-row-title">{fullName(s)}</h3>
                        <p className="pn-row-meta">{s.program}</p>
                        <p className="t-small mt-3">{r.topic}</p>
                        <p className="t-small text-fg-2 mt-1">{next ? `Next: ${fmtDate(next.startsAt)} · ${next.agenda}` : "No meeting scheduled"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-[var(--pn-line)]">
                      <Link to={`/mentor/mentees/${r.id}`} className="btn btn-outline btn-sm">
                        Open
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "completeRequest", id: r.id })}>
                        <Check size={14} aria-hidden="true" />
                        Mark complete
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Empty title="No active mentees." action={<Link to="/mentor/requests" className="btn btn-outline btn-sm">See requests</Link>}>
              Accept a request and it appears here.
            </Empty>
          )}
        </section>
        {done.length > 0 && (
          <section>
            <h2 className="t-label text-accent mb-4">Completed · {done.length}</h2>
            <Card flush>
              <ul>
                {done.map((r) => {
                  const s = state.students.find((x) => x.id === r.menteeId)!;
                  return (
                    <li key={r.id} className="border-b border-[var(--pn-line)] last:border-0">
                      <button type="button" className="pn-row-link !mx-0 !px-5 !rounded-none" onClick={() => navigate(`/mentor/mentees/${r.id}`)}>
                        <Monogram initials={initials(s)} size="sm" student />
                        <span className="min-w-0">
                          <span className="pn-row-title block truncate">{fullName(s)}</span>
                          <span className="pn-row-meta block truncate">{r.topic}</span>
                        </span>
                        <Status tone="completed" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </>
  );
}

function Relationship({ r }: { r: MentorshipRequest }) {
  const { state, dispatch } = useStore();
  const s = state.students.find((x) => x.id === r.menteeId) as Student;
  const meetings = state.meetings.filter((m) => m.requestId === r.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ date: "", time: "17:30", duration: 45, mode: "online" as "online" | "in-person", place: "", agenda: "" });

  const add = () => {
    if (!form.date || !form.agenda.trim()) return;
    dispatch({ type: "scheduleMeeting", meeting: { requestId: r.id, startsAt: new Date(`${form.date}T${form.time}:00`).toISOString(), durationMin: form.duration, mode: form.mode, place: form.place.trim() || (form.mode === "online" ? "Video call" : "To be confirmed"), agenda: form.agenda.trim() } });
    setAdding(false);
    setForm({ date: "", time: "17:30", duration: 45, mode: "online", place: "", agenda: "" });
  };

  return (
    <>
      <Link to="/mentor/mentees" className="link link-quiet t-small">
        <ArrowLeft size={14} aria-hidden="true" />
        All mentees
      </Link>
      <header className="pn-page-head mt-4">
        <div className="flex items-start gap-5">
          <Monogram initials={initials(s)} size="lg" student />
          <div>
            <Status tone={r.status} pill />
            <h1 className="mt-3">{fullName(s)}</h1>
            <p>
              {s.program} · {s.institution}
            </p>
          </div>
        </div>
        <div className="pn-page-actions">
          {r.status === "accepted" && (
            <>
              <button type="button" className="btn btn-solid btn-sm" onClick={() => setAdding(true)}>
                <CalendarPlus size={15} aria-hidden="true" />
                Add meeting
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => dispatch({ type: "completeRequest", id: r.id })}>
                <Check size={15} aria-hidden="true" />
                Mark complete
              </button>
            </>
          )}
        </div>
      </header>

      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Meetings">
            {meetings.length ? meetings.map((m) => <MeetingRow key={m.id} startsAt={m.startsAt} title={m.agenda} meta={`${m.durationMin} min · ${m.mode === "online" ? "Online" : "In person"} · ${m.place}${m.status === "completed" ? " · held" : ""}`} />) : <p className="t-small text-fg-2">Nothing logged yet. Add the first meeting once you have agreed a time.</p>}
          </Card>
          <Card title="The request" flush>
            <div className="p-5 grid gap-3">
              <p className="t-heading">{r.topic}</p>
              <p className="t-body">{r.why}</p>
              {r.goals && (
                <p className="t-body text-fg-2">
                  <span className="text-fg">Success looks like:</span> {r.goals}
                </p>
              )}
              {r.mentorNote && (
                <p className="t-small text-fg-2 border-t border-[var(--pn-line)] pt-3">
                  <span className="text-fg">Your note:</span> {r.mentorNote}
                </p>
              )}
            </div>
          </Card>
        </div>
        <div className="grid gap-6">
          <Card title={`About ${s.firstName}`} lift>
            <p className="t-small">{s.goals}</p>
            <dl className="pn-dl mt-4 t-small">
              <dt>Level</dt>
              <dd>{audiences.find((a) => a.id === s.level)?.label}</dd>
              <dt>Interests</dt>
              <dd>{s.interests.join(", ")}</dd>
              <dt>Location</dt>
              <dd>{s.location}</dd>
            </dl>
          </Card>
          <Card title="Keep it light">
            <p className="t-small text-fg-2">There is no obligation to log every conversation. Add meetings when a reminder would help; mark complete when you are done. {s.firstName} can do both too.</p>
          </Card>
        </div>
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a meeting"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-solid btn-sm" disabled={!form.date || !form.agenda.trim()} onClick={add}>
              Add meeting
            </button>
          </>
        }
      >
        <p>Both of you get a reminder the day before. This does not send a calendar invite; use your scheduling tool for that.</p>
        <div className="pn-form pn-form-2 mt-5">
          <Field label="Date">{(id) => <Input id={id} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}</Field>
          <Field label="Time">{(id) => <Input id={id} type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />}</Field>
          <Field label="Length">
            {(id) => (
              <Select id={id} value={String(form.duration)} onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </Select>
            )}
          </Field>
          <Field label="Where">
            {(id) => (
              <Select id={id} value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as "online" | "in-person" }))}>
                <option value="online">Online</option>
                <option value="in-person">In person</option>
              </Select>
            )}
          </Field>
          <Field label="Place or link" optional className="pn-form-span">{(id) => <Input id={id} value={form.place} onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))} placeholder={form.mode === "online" ? "Video link shared by email" : "Coffee shop downtown"} />}</Field>
          <Field label="Agenda" className="pn-form-span">{(id) => <Input id={id} value={form.agenda} onChange={(e) => setForm((f) => ({ ...f, agenda: e.target.value }))} placeholder="Resume walkthrough" />}</Field>
        </div>
      </Modal>
    </>
  );
}

/* ====================================================================
   21. Edit professional profile and mentorship preferences
   ==================================================================== */

export function MentorEditProfile() {
  const { me, dispatch } = useStore();
  const m = me.mentor;
  const [draft, setDraft] = useState({
    title: m.title,
    organization: m.organization,
    disciplineId: m.disciplineId,
    location: m.location,
    yearsExperience: m.yearsExperience,
    bio: m.bio,
    expertise: [...m.expertise],
    expertiseInput: "",
    interests: m.interests.join(", "),
    participation: [...m.participation] as ParticipationId[],
  });
  const dirty =
    draft.title !== m.title ||
    draft.organization !== m.organization ||
    draft.disciplineId !== m.disciplineId ||
    draft.location !== m.location ||
    draft.yearsExperience !== m.yearsExperience ||
    draft.bio !== m.bio ||
    draft.expertise.join("|") !== m.expertise.join("|") ||
    draft.interests !== m.interests.join(", ") ||
    draft.participation.join("|") !== m.participation.join("|");

  const addExpertise = () => {
    const v = draft.expertiseInput.trim().replace(/,$/, "");
    if (v && !draft.expertise.includes(v)) setDraft((d) => ({ ...d, expertise: [...d.expertise, v], expertiseInput: "" }));
    else setDraft((d) => ({ ...d, expertiseInput: "" }));
  };

  const save = () => {
    const wasMentoring = m.participation.includes("mentoring");
    const nowMentoring = draft.participation.includes("mentoring");
    dispatch({
      type: "updateProfessional",
      id: m.id,
      patch: {
        title: draft.title,
        organization: draft.organization,
        disciplineId: draft.disciplineId,
        location: draft.location,
        yearsExperience: draft.yearsExperience,
        bio: draft.bio,
        expertise: draft.expertise,
        interests: draft.interests.split(",").map((s) => s.trim()).filter(Boolean),
        participation: draft.participation,
        mentorship: nowMentoring ? m.mentorship ?? { status: "active", topics: [], audience: ["undergrad"], format: "either", mode: "either", availability: "", duration: 45, maxActive: 2 } : wasMentoring ? undefined : m.mentorship,
      },
    });
  };

  return (
    <>
      <PageHead
        kicker="Edit profile"
        title="How you appear in the directory."
        lead="Changes to your name, title or organization go live immediately; an administrator is notified of affiliation changes so verification stays honest."
        actions={
          <Link to={`/directory/${m.id}`} className="btn btn-outline btn-sm">
            View public profile
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        }
      />
      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Professional information">
            <div className="pn-form pn-form-2">
              <Field label="Job title" privacy="public">{(id) => <Input id={id} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />}</Field>
              <Field label="Company or institution" privacy="public">{(id) => <Input id={id} value={draft.organization} onChange={(e) => setDraft((d) => ({ ...d, organization: e.target.value }))} />}</Field>
              <Field label="Discipline" privacy="public">
                {(id) => (
                  <Select id={id} value={draft.disciplineId} onChange={(e) => setDraft((d) => ({ ...d, disciplineId: e.target.value }))}>
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
              <Field label="Years of experience" privacy="public">{(id) => <Input id={id} type="number" min={0} max={60} value={draft.yearsExperience} onChange={(e) => setDraft((d) => ({ ...d, yearsExperience: Number(e.target.value) || 0 }))} />}</Field>
              <Field label="General location" privacy="public">{(id) => <Input id={id} value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />}</Field>
              <Field label="Biography" privacy="public" className="pn-form-span">{(id) => <Textarea id={id} value={draft.bio} onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))} />}</Field>
              <Field label="Expertise" privacy="public" className="pn-form-span" hint="Enter or comma to add.">
                {(id) => (
                  <>
                    <Input id={id} value={draft.expertiseInput} onChange={(e) => setDraft((d) => ({ ...d, expertiseInput: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addExpertise(); } }} onBlur={addExpertise} placeholder="Add an area of expertise" />
                    <div className="pn-chips mt-3">
                      {draft.expertise.map((x) => (
                        <Chip key={x} pressed removable onClick={() => setDraft((d) => ({ ...d, expertise: d.expertise.filter((y) => y !== x) }))}>
                          {x}
                        </Chip>
                      ))}
                    </div>
                  </>
                )}
              </Field>
              <Field label="Professional interests" privacy="public" optional className="pn-form-span">{(id) => <Input id={id} value={draft.interests} onChange={(e) => setDraft((d) => ({ ...d, interests: e.target.value }))} />}</Field>
            </div>
          </Card>

          <Card title="Participation">
            <div className="pn-options">
              {participationOptions.map((o) => (
                <Option key={o.id} multi checked={draft.participation.includes(o.id)} title={o.label} note={o.id === "mentoring" ? `${o.note} Topics, audience and capacity live under Availability.` : o.note} onClick={() => setDraft((d) => ({ ...d, participation: d.participation.includes(o.id) ? d.participation.filter((x) => x !== o.id) : [...d.participation, o.id] }))} />
              ))}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-solid" disabled={!dirty || draft.expertise.length < 2} onClick={save}>
              Save profile
            </button>
            <Link to="/mentor/availability" className="btn btn-ghost">
              Mentorship preferences
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="grid gap-6">
          <Card title="Preview" lift>
            <div className="flex items-start gap-4">
              <Monogram initials={initials(m)} />
              <div className="min-w-0">
                <div className="pn-pcard-name">{fullName(m, true)}</div>
                <div className="pn-pcard-title">{draft.title}</div>
                <div className="pn-pcard-org">{draft.organization}</div>
              </div>
            </div>
            <div className="pn-tags mt-4">
              {draft.expertise.slice(0, 3).map((e) => (
                <span key={e} className="pn-tag pn-tag-quiet">
                  {e}
                </span>
              ))}
            </div>
          </Card>
          <Card title="Education">
            <ul className="pn-edu">
              {m.education.map((e) => (
                <li key={e.year} className="pn-edu-item">
                  <span className="pn-edu-year">{e.year}</span>
                  <span>
                    {e.degree}, {e.field}
                    <span className="text-fg-2 block">{e.school}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="link link-quiet t-small mt-4" onClick={() => dispatch({ type: "toast", text: "Education editing arrives with the real build." })}>
              Edit education
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ====================================================================
   Mentor privacy, contact and notifications
   ==================================================================== */

export function MentorSettings() {
  const { me, state, dispatch } = useStore();
  const m = me.mentor;
  const [visibility, setVisibility] = useState(m.visibility);
  const [contact, setContact] = useState<ContactMethodId[]>([...m.contactMethods]);
  const dirty = visibility !== m.visibility || contact.join("|") !== m.contactMethods.join("|");

  return (
    <>
      <PageHead kicker="Privacy & notifications" title="Who sees you, how they reach you, what we send." lead="Three independent settings. Being listed does not mean being contactable, and neither means mentoring." />
      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Directory visibility">
            <div className="pn-options" role="radiogroup">
              <Option checked={visibility === "public"} title="Public" note="Anyone can find your profile, including visitors who are not signed in." onClick={() => setVisibility("public")} />
              <Option checked={visibility === "members"} title="Members only" note="Only signed-in MEST members see your profile." onClick={() => setVisibility("members")} />
              <Option checked={visibility === "hidden"} title="Hidden" note="Nobody can find you. Existing mentees keep access. Use this instead of deleting when you need a break." onClick={() => setVisibility("hidden")} />
            </div>
          </Card>
          <Card title="Contact methods" aside={<span className="t-small text-fg-2">Revealed only on accept</span>}>
            <div className="pn-options">
              {contactMethods.map((c) => (
                <Option key={c.id} multi checked={contact.includes(c.id)} title={c.label} note={c.note} onClick={() => (c.id === "mest" ? undefined : setContact((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id])))} />
              ))}
            </div>
          </Card>
          <div className="flex gap-3">
            <button type="button" className="btn btn-solid" disabled={!dirty} onClick={() => dispatch({ type: "updateProfessional", id: m.id, patch: { visibility, contactMethods: contact } })}>
              Save
            </button>
          </div>
          <Card title="Notifications" flush className="px-5">
            <SwitchRow title="New mentorship request" note="One email per request, with the student's message." checked={state.notificationPrefs.newRequestEmail} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { newRequestEmail: v } })} />
            <SwitchRow title="Reminders for unanswered requests" note="Day 5 and day 10. Off means the request simply expires on day 14." checked={state.notificationPrefs.reminderEmail} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { reminderEmail: v } })} />
            <SwitchRow title="Meeting reminders" note="The day before any meeting logged here." checked={state.notificationPrefs.meetingReminders} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { meetingReminders: v } })} />
            <SwitchRow title="Monthly digest" note="New members in your discipline and upcoming MEST events." checked={state.notificationPrefs.weeklyDigest} onChange={(v) => dispatch({ type: "setNotificationPrefs", prefs: { weeklyDigest: v } })} />
          </Card>
        </div>
        <div className="grid gap-6">
          <Card title="What is never shown" lift>
            <ul className="grid gap-2 t-small text-fg-2">
              <li>Your email address, under any setting.</li>
              <li>Your phone number, unless you tick it above and only to accepted mentees.</li>
              <li>Who has requested you, or whom you declined.</li>
            </ul>
          </Card>
          <Card title="Account">
            <p className="t-small text-fg-2">Export your data or delete your account. Deletion hides your profile at once and removes personal data after 14 days; completed mentorship counts stay in MEST's aggregate statistics without your name.</p>
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
