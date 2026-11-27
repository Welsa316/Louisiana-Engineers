/**
 * Reports (03 section 8, requirement ADM-4): profiles members flagged, open
 * ones oldest first, with tabs for the resolved and dismissed ones. An
 * administrator resolves a report with an action (hide the profile, or
 * suspend the account's requests) or dismisses it; the note stays with
 * administrators, and the reporter hears the status only. The requests a
 * reported member is part of can be opened here with their text, which the
 * `admin_requests` view releases only while a report is open; opening them
 * is a deliberate click on every screen size.
 */

import { useId, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { limits } from "@shared/limits";
import { reportReasonOptions } from "@shared/taxonomy";
import { reportStatuses, type ReportAction, type ReportStatus } from "@shared/types/common";
import type { AdminReport, AdminReportsResponse, AdminRequestsResponse } from "@shared/types/reports";
import { api, isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { CharCount } from "../../ui/settings-controls";
import {
  Card,
  Drawer,
  Empty,
  Monogram,
  Notice,
  Option,
  PageHead,
  Status,
  Tabs,
  Textarea,
  Toast,
  fmtDate,
  plural,
  statusLabel,
} from "../../ui/ui";
import { ADMIN_PAGE_SIZE, adminErrorText, adminKeys, daysSince, personInitials, personName, useAdminAction } from "./api";

/* ------------------------------------------------------------- queries */

const reportKeys = {
  list: (status: ReportStatus, page: number, size: number) => [...adminKeys.all, "reports", status, page, size] as const,
  requests: (profileId: string) => [...adminKeys.all, "requests", profileId] as const,
};

/** `GET /api/admin/reports?status&page&size`. */
export function useReports(status: ReportStatus, page = 1, size = ADMIN_PAGE_SIZE) {
  return useQuery({
    queryKey: reportKeys.list(status, page, size),
    queryFn: () => api<AdminReportsResponse>(`/admin/reports?status=${status}&page=${page}&size=${size}`),
    placeholderData: keepPreviousData,
  });
}

/** `GET /api/admin/requests?profile=`, only once asked for. */
function useRequestsInvolving(profileId: string, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.requests(profileId),
    queryFn: () => api<AdminRequestsResponse>(`/admin/requests?profile=${encodeURIComponent(profileId)}&size=50`),
    enabled,
  });
}

/* ---------------------------------------------------------------- copy */

const REASON_LABEL = Object.fromEntries(reportReasonOptions.map((o) => [o.id, o.label])) as Record<string, string>;

const ACTION_LABEL: Record<ReportAction, string> = {
  none: "No action",
  hide_profile: "Profile hidden",
  suspend_requests: "Requests suspended",
  remove_account: "Account removed",
};

const TAB_LABELS: Record<ReportStatus, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };

const EMPTY: Record<ReportStatus, { title: string; body?: string }> = {
  open: { title: "No open reports.", body: "Members can report a profile from its page; reports land here." },
  resolved: { title: "Nothing resolved yet." },
  dismissed: { title: "Nothing dismissed yet." },
};

function reportErrorText(error: unknown): string {
  if (isApiError(error, "report_closed")) return "This report was already closed, possibly by another administrator.";
  if (isApiError(error, "own_report")) return "This report is about you, so another administrator has to decide it.";
  if (isApiError(error, "admin_minimum")) {
    return "This would leave fewer than two administrators. Grant the role to someone else first.";
  }
  if (isApiError(error, "invalid_action")) {
    return "That action does not fit this report. A dismissal takes no action, and you cannot suspend your own account.";
  }
  return adminErrorText(error);
}

/** Where the reported profile stands right now, in one label. */
function standing(r: AdminReport): { tone: Parameters<typeof Status>[0]["tone"]; label: string } {
  const p = r.profile;
  if (p.former) return { tone: "off", label: "Former member" };
  if (p.suspended) return { tone: "declined", label: "Requests suspended" };
  if (p.adminHidden) return { tone: "off", label: "Hidden by admin" };
  if (p.kind === "student") return { tone: "active", label: "Student" };
  if (p.kind === null) return { tone: "pending", label: "Not onboarded" };
  if (p.approvalState === "pending") return { tone: "pending", label: "Pending review" };
  if (p.approvalState === "declined") return { tone: "declined", label: "Needs changes" };
  if (p.visibility === "hidden") return { tone: "off", label: "Hidden by member" };
  return { tone: "approved", label: p.visibility === "members" ? "Members only" : "Listed" };
}

const ageText = (iso: string) => {
  const days = daysSince(iso);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

const nameOf = (p: { firstName: string | null; lastName: string | null; former: boolean; credentials?: string | null }) =>
  p.former ? "Former member" : personName(p);

/* ---------------------------------------------------------------- page */

function statusFrom(value: string | null): ReportStatus {
  return (reportStatuses as readonly string[]).includes(value ?? "") ? (value as ReportStatus) : "open";
}

export function Reports() {
  useMeta({ title: "Reports" });
  const [params, setParams] = useSearchParams();
  const status = statusFrom(params.get("status"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useReports(status, page);
  const counts = {
    open: useReports("open", 1, 1).data?.total,
    resolved: useReports("resolved", 1, 1).data?.total,
    dismissed: useReports("dismissed", 1, 1).data?.total,
  };
  const [resolving, setResolving] = useState<AdminReport | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const setTab = (next: ReportStatus) => setParams(next === "open" ? {} : { status: next });
  const setPage = (next: number) =>
    setParams({ ...(status === "open" ? {} : { status }), ...(next > 1 ? { page: String(next) } : {}) });

  return (
    <>
      <PageHead
        kicker="Reports"
        title="Flagged profiles."
        lead="Reporters stay anonymous to the member. Resolve a report with an action when something needs doing, or dismiss it when nothing does. Your note stays with administrators."
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}

      <div className="mt-8">
        <Tabs
          label="Report status"
          value={status}
          onChange={setTab}
          tabs={reportStatuses.map((s) => ({ id: s, label: TAB_LABELS[s], count: counts[s] }))}
        />
      </div>

      <div className="mt-6">
        {list.isError ? (
          <div role="alert">
            <Notice tone="warn">{reportErrorText(list.error)}</Notice>
          </div>
        ) : !list.data ? (
          <p className="t-small text-fg-2">Loading reports</p>
        ) : list.data.items.length === 0 ? (
          <Empty title={EMPTY[status].title}>{EMPTY[status].body}</Empty>
        ) : status === "open" ? (
          <ul className="grid gap-6" aria-label="Open reports">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <OpenReport report={r} onResolve={() => setResolving(r)} />
              </li>
            ))}
          </ul>
        ) : (
          <ClosedReports items={list.data.items} />
        )}
        {list.data ? (
          <Pager page={page} size={ADMIN_PAGE_SIZE} total={list.data.total} onPage={setPage} label="Report pages" />
        ) : null}
      </div>

      <ResolveDialog
        report={resolving}
        onClose={() => setResolving(null)}
        onDone={(text) => {
          setResolving(null);
          setFlash(text);
        }}
      />
    </>
  );
}

/* ---------------------------------------------------------- open report */

function OpenReport({ report: r, onResolve }: { report: AdminReport; onResolve: () => void }) {
  const [showRequests, setShowRequests] = useState(false);
  const p = r.profile;
  const name = nameOf(p);
  const state = standing(r);
  const listed = state.tone === "approved" && p.kind === "professional";
  const others = r.openReportsOnProfile - 1;

  return (
    <Card as="article" title={name} aside={<Status tone="open" />}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="grid gap-4 grid-cols-[auto_minmax(0,1fr)] items-start">
          <Monogram initials={personInitials(p)} student={p.kind === "student"} />
          <div className="min-w-0">
            <p className="t-small text-fg-2">
              {[p.title, p.organization].filter(Boolean).join(" · ") || (p.kind === "student" ? "Student" : "")}
            </p>
            <p className="t-body mt-3">
              <strong className="font-medium">{REASON_LABEL[r.reason] ?? r.reason}.</strong> {r.detail ?? "No detail given."}
            </p>
            <p className="t-small text-fg-2 mt-2">Reported {ageText(r.createdAt)}</p>
            <div className="pn-admin-actions mt-5">
              <button type="button" className="btn btn-solid btn-sm" onClick={onResolve}>
                Resolve or dismiss<span className="sr-only"> the report about {name}</span>
              </button>
              {listed ? (
                <Link to={`/directory/${p.id}`} className="btn btn-outline btn-sm">
                  View profile<span className="sr-only"> of {name}</span>
                </Link>
              ) : p.kind === "professional" && p.approvalState === "pending" ? (
                <Link to="/admin/queue" className="btn btn-outline btn-sm">
                  Open the approval queue
                </Link>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={showRequests}
                aria-controls={`report-requests-${r.id}`}
                onClick={() => setShowRequests((v) => !v)}
              >
                {showRequests ? "Hide requests" : "Show requests"}
                <span className="sr-only"> involving {name}</span>
              </button>
            </div>
          </div>
        </div>
        <dl className="grid gap-3 content-start t-small md:border-l md:border-[var(--pn-line)] md:pl-6">
          <div>
            <dt className="text-fg-2">Standing</dt>
            <dd>
              <Status tone={state.tone} label={state.label} />
            </dd>
          </div>
          <div>
            <dt className="text-fg-2">Reported by</dt>
            <dd>{r.reporter ? nameOf(r.reporter) : "Former member"}</dd>
          </div>
          <div>
            <dt className="text-fg-2">Other open reports</dt>
            <dd>{others > 0 ? plural(others, "report") : "None"}</dd>
          </div>
        </dl>
      </div>
      {showRequests ? <RequestsInvolving id={`report-requests-${r.id}`} profileId={p.id} name={name} /> : null}
    </Card>
  );
}

function RequestsInvolving({ id, profileId, name }: { id: string; profileId: string; name: string }) {
  const requests = useRequestsInvolving(profileId, true);
  return (
    <section id={id} className="mt-6 border-t border-[var(--pn-line)] pt-5" aria-label={`Requests involving ${name}`}>
      <h3 className="t-small text-fg-2">Requests involving {name}</h3>
      <p className="t-small text-fg-2 mt-1">
        The text of these requests is visible only while a report about one of the people is open.
      </p>
      {requests.isError ? (
        <div role="alert" className="mt-3">
          <Notice tone="warn">{reportErrorText(requests.error)}</Notice>
        </div>
      ) : !requests.data ? (
        <p className="t-small text-fg-2 mt-3">Loading requests</p>
      ) : requests.data.items.length === 0 ? (
        <p className="t-small mt-3">No requests.</p>
      ) : (
        <ul className="mt-3 grid gap-4">
          {requests.data.items.map((q) => (
            <li key={q.id} className="border-l-2 border-[var(--pn-line)] pl-4">
              <p className="t-small">
                <strong className="font-medium">{nameOf(q.mentee)}</strong> to{" "}
                <strong className="font-medium">{nameOf(q.mentor)}</strong>
                {" · "}
                {q.kind === "introduction" ? "Introduction" : (q.topicLabel ?? "Mentorship")}
                {" · "}
                <Status tone={q.status} label={statusLabel[q.status]} /> {" · "}
                {fmtDate(q.createdAt, true)}
              </p>
              {q.underReport && !q.textPurged ? (
                <dl className="grid gap-2 t-small mt-2 [&_dt]:text-fg-2 [&_dd]:mt-0.5">
                  {q.why ? (
                    <div>
                      <dt>Why</dt>
                      <dd>{q.why}</dd>
                    </div>
                  ) : null}
                  {q.goals ? (
                    <div>
                      <dt>Goals</dt>
                      <dd>{q.goals}</dd>
                    </div>
                  ) : null}
                  {q.schedulingNote ? (
                    <div>
                      <dt>Scheduling note</dt>
                      <dd>{q.schedulingNote}</dd>
                    </div>
                  ) : null}
                  {q.mentorNote ? (
                    <div>
                      <dt>Mentor's reply</dt>
                      <dd>{q.mentorNote}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="t-small text-fg-2 mt-1">
                  {q.textPurged ? "Text removed after the retention period." : "Text hidden."}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------- closed reports */

function ClosedReports({ items }: { items: AdminReport[] }) {
  return (
    <Card flush>
      <div className="pn-table-wrap">
        <table className="pn-table">
          <caption className="sr-only">Closed reports</caption>
          <thead>
            <tr>
              <th scope="col">Profile</th>
              <th scope="col">Reason</th>
              <th scope="col">Outcome</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="pn-table-person pn-admin-person">
                    <Monogram initials={personInitials(r.profile)} size="sm" student={r.profile.kind === "student"} />
                    <div className="min-w-0">
                      <strong>{nameOf(r.profile)}</strong>
                      <span>Reported {fmtDate(r.createdAt, true)}</span>
                    </div>
                  </div>
                </td>
                <td data-label="Reason">{REASON_LABEL[r.reason] ?? r.reason}</td>
                <td data-label="Outcome">
                  <Status tone={r.status === "resolved" ? "resolved" : "dismissed"} />{" "}
                  <span className="text-fg-2">
                    {r.action ? ACTION_LABEL[r.action] : ""}
                    {r.resolvedAt ? ` · ${fmtDate(r.resolvedAt, true)}` : ""}
                    {r.resolvedBy ? ` · ${nameOf(r.resolvedBy)}` : ""}
                  </span>
                </td>
                <td data-label="Note">{r.resolutionNote ?? <span className="text-fg-2">No note</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- resolve dialog */

type Outcome = "resolved" | "dismissed";
type Act = ReportAction;

const ACTION_CHOICES: { id: Act; title: string; note: string }[] = [
  { id: "none", title: "No further action", note: "Close the report; the profile stays as it is." },
  {
    id: "hide_profile",
    title: "Hide the profile",
    note: "Out of the directory and mentoring turned off. Restore it later from Members.",
  },
  {
    id: "suspend_requests",
    title: "Suspend requests",
    note: "The member can no longer send, answer or receive contact through requests. They are told, without your note or who reported them.",
  },
  {
    id: "remove_account",
    title: "Remove the account",
    note: "Hidden at once and deleted at the next daily sweep, with no grace period. Your note is kept as the reason. This cannot be undone.",
  },
];

function ResolveDialog({
  report,
  onClose,
  onDone,
}: {
  report: AdminReport | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("resolved");
  const [action, setAction] = useState<Act>("none");
  const [note, setNote] = useState("");
  const resolve = useAdminAction((vars: { id: string; body: Record<string, unknown> }) => ({
    path: `/admin/reports/${vars.id}/resolve`,
    method: "POST",
    body: vars.body,
  }));
  const name = report ? nameOf(report.profile) : "";
  const tooLong = Array.from(note.trim()).length > limits.reportDetail.max;
  const formId = useId();

  const reset = () => {
    setOutcome("resolved");
    setAction("none");
    setNote("");
    resolve.reset();
  };
  const close = () => {
    reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!report || tooLong || resolve.isPending) return;
    const act: Act = outcome === "dismissed" ? "none" : action;
    resolve.mutate(
      { id: report.id, body: { status: outcome, action: act, ...(note.trim() ? { note: note.trim() } : {}) } },
      {
        onSuccess: () => {
          const text =
            outcome === "dismissed"
              ? `Report about ${name} dismissed.`
              : act === "hide_profile"
                ? `Report resolved. ${name}'s profile is hidden.`
                : act === "suspend_requests"
                  ? `Report resolved. Requests are suspended for ${name}.`
                  : act === "remove_account"
                    ? `Report resolved. ${name}'s account is hidden and will be deleted at the next daily sweep.`
                    : `Report about ${name} resolved.`;
          reset();
          onDone(text);
        },
      },
    );
  };

  return (
    // A drawer, like the review drawer: its body scrolls and the buttons stay
    // pinned, so the longest choice list still fits a phone; on a desktop it
    // sits beside the list, keeping the report in view.
    <Drawer
      open={report !== null}
      onClose={close}
      title={report ? `Close the report about ${name}` : "Close the report"}
      footer={
        <div className="pn-admin-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-solid btn-sm" disabled={tooLong || resolve.isPending}>
            {resolve.isPending ? "Saving" : outcome === "dismissed" ? "Dismiss report" : "Resolve report"}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        {report ? (
          <p className="t-small text-fg-2">
            {REASON_LABEL[report.reason] ?? report.reason}. {report.detail ?? "No detail given."}
          </p>
        ) : null}
        <p className="t-small mt-3">
          The reporter is told the report was reviewed. They never see your note or which action you took.
        </p>
        <div className="mt-5">
          <fieldset className="pn-fieldset">
            <legend className="t-small">Outcome</legend>
            <div className="pn-options pn-options-2">
              <Option
                name="report-outcome"
                checked={outcome === "resolved"}
                title="Resolve"
                note="Something needed doing."
                onClick={() => setOutcome("resolved")}
              />
              <Option
                name="report-outcome"
                checked={outcome === "dismissed"}
                title="Dismiss"
                note="Nothing needed doing."
                onClick={() => setOutcome("dismissed")}
              />
            </div>
          </fieldset>
        </div>
        {outcome === "resolved" ? (
          <div className="mt-5">
            <fieldset className="pn-fieldset">
              <legend className="t-small">Action</legend>
              <div className="pn-options">
                {ACTION_CHOICES.map((choice) => (
                  <Option
                    key={choice.id}
                    name="report-action"
                    checked={action === choice.id}
                    title={choice.title}
                    note={choice.note}
                    onClick={() => setAction(choice.id)}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}
        <div className="field mt-5">
          <label className="field-label pn-field-label t-small" htmlFor="report-resolution-note">
            <span>
              Note for administrators <span className="text-fg-2">(optional)</span>
            </span>
          </label>
          <Textarea
            id="report-resolution-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            aria-describedby="report-resolution-count"
            aria-invalid={tooLong || undefined}
          />
          <p className="pn-field-hint" id="report-resolution-count">
            <CharCount value={note} max={limits.reportDetail.max} />
          </p>
        </div>
        {resolve.isError ? (
          <div role="alert" className="mt-4">
            <Notice tone="warn">{reportErrorText(resolve.error)}</Notice>
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}
