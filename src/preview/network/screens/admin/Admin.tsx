import { useMemo, useState } from "react";
import { ArrowRight, Check, Flag, Search, ShieldCheck, X } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useStore, isListed } from "../../state/store";
import { disciplineById, disciplines } from "../../data/taxonomy";
import { fullName, initials, TODAY } from "../../data/mock";
import type { Professional } from "../../data/types";
import { Card, Drawer, Empty, fmtDate, fmtRelative, fmtRelativeLower, Monogram, Notice, PageHead, Stat, Status, Tabs } from "../../components/ui";

/* ====================================================================
   22. Admin overview
   ==================================================================== */

export function AdminOverview() {
  const { state } = useStore();
  const pros = state.professionals;
  const listed = pros.filter((p) => isListed(p, "admin") && p.visibility !== "hidden");
  const pendingApprovals = pros.filter((p) => p.approval === "pending");
  const mentors = pros.filter((p) => p.approval === "approved" && p.mentorship);
  const activeMentors = mentors.filter((p) => p.mentorship!.status === "active");
  const openReports = state.reports.filter((r) => r.status === "open");
  const reqs = state.requests;
  const pending = reqs.filter((r) => r.status === "pending");
  const answered = reqs.filter((r) => r.respondedAt && (r.status === "accepted" || r.status === "declined"));
  const within7 = answered.filter((r) => (new Date(r.respondedAt!).getTime() - new Date(r.createdAt).getTime()) / 86_400_000 <= 7).length;
  const acceptRate = answered.length ? Math.round((reqs.filter((r) => r.status === "accepted" || r.status === "completed").length / (answered.length + reqs.filter((r) => r.status === "completed").length)) * 100) : 0;

  return (
    <>
      <PageHead kicker="Administration" title="How the network is doing." lead="Enough to run the program and report to the board. No per-person surveillance: administrators see aggregates here and individual records only in the queues." />

      <div className="pn-stats mt-8">
        <Stat label="Listed professionals" value={listed.length} note={`${pros.filter((p) => p.approval === "approved").length} approved in total`} />
        <Stat label="Students" value={state.students.length} />
        <Stat label="Active mentors" value={activeMentors.length} unit={`of ${mentors.length}`} />
        <Stat label="Needs attention" value={pendingApprovals.length + openReports.length} note={`${pendingApprovals.length} approvals · ${openReports.length} reports`} />
      </div>

      <div className="pn-split mt-8">
        <div className="grid gap-6">
          <Card title="Mentorship this quarter" aside={<Link to="/admin/mentorship" className="link link-quiet t-small">Detail</Link>}>
            <div className="grid grid-cols-3 gap-4">
              {[
                [String(reqs.length), "requests sent"],
                [`${answered.length ? Math.round((within7 / answered.length) * 100) : 0}%`, "answered within 7 days"],
                [`${acceptRate}%`, "accepted"],
              ].map(([v, l]) => (
                <div key={l} className="border-l border-[var(--pn-line)] pl-4">
                  <div className="pn-stat-value !text-[2rem]">{v}</div>
                  <div className="pn-stat-label mt-1">{l}</div>
                </div>
              ))}
            </div>
            <p className="t-small text-fg-2 mt-5">{pending.length} requests are waiting on a mentor right now. The oldest expires {pending.length ? fmtDate([...pending].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0].expiresAt) : "—"}.</p>
          </Card>

          <Card title="Activity" lift>
            <ul className="pn-timeline">
              {state.activity.slice(0, 8).map((a) => (
                <li key={a.id} className="pn-timeline-item">
                  <span className="pn-timeline-when">{fmtRelative(a.at, TODAY)}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card accent title="Queue" aside={<Link to="/admin/approvals" className="link link-quiet t-small">Open</Link>}>
            <ul className="grid gap-3">
              {pendingApprovals.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Monogram initials={initials(p)} size="sm" />
                  <Link to={`/admin/approvals/${p.id}`} className="link link-quiet min-w-0 truncate">
                    {fullName(p, true)}
                  </Link>
                  <span className="t-small text-fg-2 ml-auto whitespace-nowrap">{fmtRelative(p.joinedAt, TODAY)}</span>
                </li>
              ))}
              {pendingApprovals.length === 0 && <li className="t-small text-fg-2">Nothing waiting for review.</li>}
            </ul>
            {openReports.length > 0 && (
              <div className="mt-5 pt-4 border-t border-[var(--pn-line)]">
                <Link to="/admin/reports" className="pn-status" data-tone="open">
                  {openReports.length} open {openReports.length === 1 ? "report" : "reports"}
                </Link>
              </div>
            )}
          </Card>

          <Card title="By discipline">
            <ul className="grid gap-2 t-small">
              {disciplines
                .map((d) => ({ d, n: listed.filter((p) => p.disciplineId === d.id).length }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n)
                .map(({ d, n }) => (
                  <li key={d.id} className="flex items-center gap-3">
                    <span className="min-w-0 truncate">{d.label}</span>
                    <span className="flex-1 h-px bg-[var(--pn-line)]" aria-hidden="true" />
                    <span className="t-numeral text-fg-2">{n}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ====================================================================
   23. Professional approval queue
   ==================================================================== */

export function AdminApprovals({ selectedId }: { selectedId?: string }) {
  const { state, dispatch } = useStore();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<"pending" | "declined">("pending");
  const list = state.professionals.filter((p) => p.approval === tab).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const selected = selectedId ? state.professionals.find((p) => p.id === selectedId) : undefined;
  const report = selected && state.reports.find((r) => r.profileId === selected.id && r.status === "open");

  return (
    <>
      <PageHead kicker="Approval queue" title="Profiles waiting to be listed." lead="Read the profile as a visitor would. Approve if it is a real person in a STEM role with a sensible bio. Decline sends a short email with your reason and lets them resubmit." />
      <div className="mt-8">
        <Tabs
          label="Queue"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "pending", label: "Waiting", count: state.professionals.filter((p) => p.approval === "pending").length },
            { id: "declined", label: "Declined", count: state.professionals.filter((p) => p.approval === "declined").length },
          ]}
        />
      </div>
      <Card flush className="mt-6">
        {list.length ? (
          <div className="pn-table-wrap"><table className="pn-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Discipline</th>
                <th>Submitted</th>
                <th>Signals</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="pn-table-person">
                      <Monogram initials={initials(p)} size="sm" />
                      <div className="min-w-0">
                        <strong>{fullName(p, true)}</strong>
                        <span>
                          {p.title} · {p.organization}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Discipline">{disciplineById(p.disciplineId)?.label}</td>
                  <td data-label="Submitted">{fmtRelative(p.joinedAt, TODAY)}</td>
                  <td data-label="Signals">
                    <div className="flex flex-wrap gap-2">
                      {p.hasLinkedIn && <span className="pn-tag pn-tag-quiet">LinkedIn</span>}
                      {p.participation.includes("mentoring") && <span className="pn-tag pn-tag-quiet">Wants to mentor</span>}
                      {state.reports.some((r) => r.profileId === p.id && r.status === "open") && <span className="pn-tag" style={{ color: "var(--pn-neg)", borderColor: "color-mix(in srgb, var(--pn-neg) 40%, transparent)" }}>Reported</span>}
                      {p.bio.length < 80 && <span className="pn-tag pn-tag-quiet">Short bio</span>}
                    </div>
                  </td>
                  <td>
                    <div className="pn-table-actions">
                      <button type="button" className="btn btn-outline btn-xs" onClick={() => navigate(`/admin/approvals/${p.id}`)}>
                        Review
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="p-5">
            <Empty inline title={tab === "pending" ? "Queue is clear." : "Nothing declined."}>{tab === "pending" ? "New professional profiles land here as they are submitted." : ""}</Empty>
          </div>
        )}
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => navigate("/admin/approvals")}
        title={selected ? fullName(selected, true) : ""}
        footer={
          selected && selected.approval === "pending" ? (
            <>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => { dispatch({ type: "reviewProfile", id: selected.id, decision: "declined" }); navigate("/admin/approvals"); }}>
                <X size={15} aria-hidden="true" />
                Decline
              </button>
              <button type="button" className="btn btn-solid btn-sm" onClick={() => { dispatch({ type: "reviewProfile", id: selected.id, decision: "approved" }); navigate("/admin/approvals"); }}>
                <Check size={15} aria-hidden="true" />
                Approve and list
              </button>
            </>
          ) : selected ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { dispatch({ type: "reviewProfile", id: selected.id, decision: "approved" }); navigate("/admin/approvals"); }}>
              Approve after all
            </button>
          ) : undefined
        }
      >
        {selected && <ReviewBody p={selected} reported={Boolean(report)} />}
      </Drawer>
    </>
  );
}

function ReviewBody({ p, reported }: { p: Professional; reported: boolean }) {
  const { dispatch } = useStore();
  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        <Monogram initials={initials(p)} size="lg" />
        <div className="min-w-0">
          <div className="pn-row-title">{p.title}</div>
          <div className="pn-row-meta">
            {p.organization} · {p.location}
          </div>
          <div className="pn-tags mt-3">
            <span className="pn-tag pn-tag-quiet">{disciplineById(p.disciplineId)?.label}</span>
            <span className="pn-tag pn-tag-quiet">{p.yearsExperience} yrs</span>
            <span className="pn-tag pn-tag-quiet">{p.visibility === "public" ? "Public" : "Members only"}</span>
          </div>
        </div>
      </div>
      {reported && (
        <Notice tone="warn" icon={<Flag size={16} aria-hidden="true" />}>
          <strong>This profile has an open report.</strong> Review it under Reports before approving.
        </Notice>
      )}
      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Biography</h3>
        <p className="t-body">{p.bio}</p>
      </section>
      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Expertise</h3>
        <div className="pn-tags">
          {p.expertise.map((e) => (
            <span key={e} className="pn-tag">
              {e}
            </span>
          ))}
        </div>
      </section>
      {p.mentorship && (
        <section>
          <h3 className="pn-kicker pn-kicker-plain mb-3">Wants to mentor</h3>
          <p className="t-small text-fg-2">
            {p.mentorship.topics.join(", ")} · up to {p.mentorship.maxActive} at once · {p.mentorship.availability}
          </p>
        </section>
      )}
      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Verification</h3>
        <p className="t-small text-fg-2">Sign-up email domain, LinkedIn link and organization are the signals for now. Mark verified only when the affiliation checks out.</p>
        <button type="button" className="btn btn-outline btn-xs mt-3" aria-pressed={p.verified} onClick={() => dispatch({ type: "setVerified", id: p.id, verified: !p.verified })}>
          <ShieldCheck size={13} aria-hidden="true" />
          {p.verified ? "Verified · click to clear" : "Mark affiliation verified"}
        </button>
      </section>
      <section>
        <h3 className="pn-kicker pn-kicker-plain mb-3">Private to administrators</h3>
        <dl className="pn-dl t-small">
          <dt>Email</dt>
          <dd>{p.firstName.toLowerCase()}@example.com (sample)</dd>
          <dt>Joined</dt>
          <dd>{fmtDate(p.joinedAt, true)}</dd>
          <dt>Contact via</dt>
          <dd>{p.contactMethods.join(", ")}</dd>
        </dl>
      </section>
    </div>
  );
}

/* ====================================================================
   24. Member management
   ==================================================================== */

type MemberTab = "all" | "professionals" | "mentors" | "students" | "hidden";

export function AdminMembers() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<MemberTab>("all");
  const [q, setQ] = useState("");

  type Row = { id: string; name: string; initials: string; kind: "Professional" | "Student"; detail: string; status: string; tone: "approved" | "pending" | "declined" | "active" | "paused" | "off"; student?: boolean; p?: Professional };
  const rows: Row[] = useMemo(() => {
    const pros: Row[] = state.professionals.map((p) => ({
      id: p.id,
      name: fullName(p, true),
      initials: initials(p),
      kind: "Professional",
      detail: `${p.title} · ${p.organization}`,
      status: p.approval === "approved" ? (p.visibility === "hidden" ? "Hidden" : p.visibility === "members" ? "Members only" : "Listed") : p.approval === "pending" ? "Awaiting review" : "Declined",
      tone: p.approval === "approved" ? (p.visibility === "hidden" ? "off" : "approved") : p.approval,
      p,
    }));
    const studs: Row[] = state.students.map((s) => ({ id: s.id, name: fullName(s), initials: initials(s), kind: "Student", detail: s.program, status: "Active", tone: "active", student: true }));
    return [...pros, ...studs];
  }, [state.professionals, state.students]);

  const filtered = rows
    .filter((r) => (tab === "all" ? true : tab === "professionals" ? r.kind === "Professional" : tab === "mentors" ? Boolean(r.p?.mentorship) : tab === "students" ? r.kind === "Student" : r.p?.visibility === "hidden"))
    .filter((r) => !q || `${r.name} ${r.detail}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead kicker="Members" title="Everyone with an account." lead="Hide a profile when something needs looking into; approval and reports have their own queues. Personal contact details are not shown in this list." />
      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <Tabs
          label="Member type"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "all", label: "All", count: rows.length },
            { id: "professionals", label: "Professionals", count: state.professionals.length },
            { id: "mentors", label: "Mentors", count: state.professionals.filter((p) => p.mentorship).length },
            { id: "students", label: "Students", count: state.students.length },
            { id: "hidden", label: "Hidden", count: state.professionals.filter((p) => p.visibility === "hidden").length },
          ]}
        />
        <div className="pn-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" aria-label="Search members" style={{ minHeight: "2.75rem" }} />
        </div>
      </div>
      <Card flush className="mt-6">
        <div className="pn-table-wrap"><table className="pn-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Type</th>
              <th>Status</th>
              <th>Mentoring</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="pn-table-person">
                    <Monogram initials={r.initials} size="sm" student={r.student} />
                    <div className="min-w-0">
                      <strong>{r.name}</strong>
                      <span>{r.detail}</span>
                    </div>
                  </div>
                </td>
                <td data-label="Type">{r.kind}</td>
                <td data-label="Status">
                  <Status tone={r.tone} label={r.status} />
                </td>
                <td data-label="Mentoring">{r.p?.mentorship ? <Status tone={r.p.mentorship.status} /> : <span className="text-fg-2">—</span>}</td>
                <td>
                  <div className="pn-table-actions">
                    {r.p && r.p.approval === "approved" && (
                      <>
                        <Link to={`/directory/${r.p.id}`} className="btn btn-ghost btn-xs">
                          View
                        </Link>
                        <button type="button" className="btn btn-outline btn-xs" onClick={() => dispatch({ type: "updateProfessional", id: r.p!.id, patch: { visibility: r.p!.visibility === "hidden" ? "public" : "hidden" } })}>
                          {r.p.visibility === "hidden" ? "Unhide" : "Hide"}
                        </button>
                      </>
                    )}
                    {r.p && r.p.approval === "pending" && (
                      <Link to={`/admin/approvals/${r.p.id}`} className="btn btn-outline btn-xs">
                        Review
                      </Link>
                    )}
                    {r.student && (
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => dispatch({ type: "toast", text: "Student profiles are visible to administrators in the real build." })}>
                        View
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {filtered.length === 0 && (
          <div className="p-5">
            <Empty inline title="No members match." />
          </div>
        )}
      </Card>
    </>
  );
}

/* ====================================================================
   25. Mentorship activity overview
   ==================================================================== */

export function AdminMentorship() {
  const { state } = useStore();
  const reqs = state.requests;
  const byStatus = (s: string) => reqs.filter((r) => r.status === s).length;
  const mentors = state.professionals.filter((p) => p.approval === "approved" && p.mentorship);
  const load = mentors
    .map((p) => ({ p, active: reqs.filter((r) => r.mentorId === p.id && r.status === "accepted").length, pending: reqs.filter((r) => r.mentorId === p.id && r.status === "pending").length, completed: reqs.filter((r) => r.mentorId === p.id && r.status === "completed").length }))
    .sort((a, b) => b.pending + b.active - (a.pending + a.active));
  const topics = Object.entries(
    reqs.reduce<Record<string, number>>((acc, r) => {
      acc[r.topic] = (acc[r.topic] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...topics.map((t) => t[1]), 1);

  return (
    <>
      <PageHead kicker="Mentorship activity" title="Is the program working?" lead="Aggregates for the board report, plus a per-mentor load view so nobody quietly carries the whole program. Message content is never visible here." />
      <div className="pn-stats mt-8">
        <Stat label="Pending" value={byStatus("pending")} />
        <Stat label="Accepted" value={byStatus("accepted")} note="in progress" />
        <Stat label="Completed" value={byStatus("completed")} />
        <Stat label="Declined / expired" value={byStatus("declined") + byStatus("expired")} note={`${byStatus("canceled")} withdrawn`} />
      </div>
      <div className="pn-split mt-8">
        <Card title="Mentor load" flush>
          <div className="pn-table-wrap"><table className="pn-table">
            <thead>
              <tr>
                <th>Mentor</th>
                <th>Status</th>
                <th className="pn-num">Pending</th>
                <th className="pn-num">Active / cap</th>
                <th className="pn-num">Completed</th>
              </tr>
            </thead>
            <tbody>
              {load.map(({ p, active, pending, completed }) => (
                <tr key={p.id}>
                  <td>
                    <div className="pn-table-person">
                      <Monogram initials={initials(p)} size="sm" />
                      <div className="min-w-0">
                        <strong>{fullName(p)}</strong>
                        <span>{disciplineById(p.disciplineId)?.label}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Status">
                    <Status tone={p.mentorship!.status} />
                  </td>
                  <td className="pn-num" data-label="Pending">
                    {pending}
                  </td>
                  <td className="pn-num" data-label="Active / cap">
                    {active} / {p.mentorship!.maxActive}
                  </td>
                  <td className="pn-num" data-label="Completed">
                    {completed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        <Card title="Requests by topic">
          <ul className="grid gap-3">
            {topics.map(([t, n]) => (
              <li key={t} className="grid gap-1 t-small">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{t}</span>
                  <span className="t-numeral text-fg-2">{n}</span>
                </div>
                <div className="h-1 rounded-full bg-[var(--pn-line)] overflow-hidden" aria-hidden="true">
                  <div className="h-full bg-[var(--color-purple)]" style={{ width: `${(n / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="t-small text-fg-2 mt-5">Bars are relative to the most requested topic, not shares of the total.</p>
        </Card>
      </div>
    </>
  );
}

/* ====================================================================
   Reports and moderation
   ==================================================================== */

export function AdminReports() {
  const { state, dispatch } = useStore();
  const open = state.reports.filter((r) => r.status === "open");
  const closed = state.reports.filter((r) => r.status !== "open");
  return (
    <>
      <PageHead kicker="Reports" title="Flagged profiles." lead="Reporters stay anonymous to the member. Resolving a report does not change the profile; hide it from Members or decline it in the queue if action is needed." />
      <div className="mt-8 grid gap-6">
        {open.length ? (
          open.map((r) => {
            const p = state.professionals.find((x) => x.id === r.profileId)!;
            return (
              <Card key={r.id} as="article" aside={<Status tone="open" />} title={fullName(p, true)}>
                <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
                  <Monogram initials={initials(p)} />
                  <div>
                    <p className="t-small text-fg-2">
                      {p.title} · {p.organization} · {p.approval === "pending" ? "awaiting approval" : "listed"}
                    </p>
                    <p className="t-body mt-3">
                      <span className="text-accent">{r.reason}.</span> {r.detail}
                    </p>
                    <p className="t-small text-fg-2 mt-2">Reported {fmtRelativeLower(r.reportedAt, TODAY)}</p>
                    <div className="flex flex-wrap gap-3 mt-5">
                      <Link to={p.approval === "pending" ? `/admin/approvals/${p.id}` : `/directory/${p.id}`} className="btn btn-outline btn-sm">
                        {p.approval === "pending" ? "Open in approval queue" : "View profile"}
                      </Link>
                      <button type="button" className="btn btn-solid btn-sm" onClick={() => dispatch({ type: "resolveReport", id: r.id, outcome: "resolved" })}>
                        <Check size={14} aria-hidden="true" />
                        Resolve
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "resolveReport", id: r.id, outcome: "dismissed" })}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <Empty title="No open reports.">Members can report a profile from its page; reports land here.</Empty>
        )}
        {closed.length > 0 && (
          <Card title="Closed" flush>
            <ul>
              {closed.map((r) => {
                const p = state.professionals.find((x) => x.id === r.profileId)!;
                return (
                  <li key={r.id} className="pn-row !px-5 border-b border-[var(--pn-line)] last:border-0">
                    <Monogram initials={initials(p)} size="sm" />
                    <span className="min-w-0">
                      <span className="pn-row-title block truncate">{fullName(p)}</span>
                      <span className="pn-row-meta block truncate">{r.reason}</span>
                    </span>
                    <Status tone={r.status} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
