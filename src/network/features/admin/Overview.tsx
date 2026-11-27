/**
 * Administration overview: the dashboard counts and the running measures
 * (`admin_dashboard`, migration 0009: approval time, open reports, the 7-day
 * answer share, inactive members), the oldest submissions waiting for review
 * and the expertise tags waiting for a decision. Aggregates only; individual
 * records live in the queues, and the request measures in full on the
 * mentorship screen.
 */

import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Monogram, Notice, PageHead, Stat, fmtRelative, fmtRelativeLower, plural } from "../../ui/ui";
import { adminErrorText, personInitials, personName, useAdminDashboard, useReviews, useTags } from "./api";
import { duration, measure } from "./measures";

export function Overview() {
  useMeta({ title: "Administration" });
  const dashboard = useAdminDashboard();
  const queue = useReviews("pending", 1, 5);
  const tags = useTags("proposed", 1, 1);
  const today = new Date().toISOString();
  const counts = dashboard.data;
  const loading = <span className="sr-only">Loading</span>;
  const approval = duration(counts ? counts.medianHoursToApproval : undefined);

  return (
    <>
      <PageHead
        kicker="Administration"
        title="How the network is doing."
        lead="Counts for running the program and reporting to the board. Individual records appear only in the queues."
      />

      {dashboard.isError ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{adminErrorText(dashboard.error)}</Notice>
        </div>
      ) : (
        <div aria-busy={dashboard.isPending || undefined}>
          <div className="pn-stats mt-8">
            <Stat label="Listed professionals" value={counts?.approvedProfessionals ?? loading} />
            <Stat label="Waiting for review" value={counts?.pendingProfessionals ?? loading} />
            <Stat label="Students" value={counts?.students ?? loading} />
            <Stat label="Active mentors" value={counts?.activeMentors ?? loading} note="Taking requests, with a free slot" />
          </div>
          <div className="pn-stats mt-4">
            <Stat
              label="Time to a decision"
              value={approval.value}
              unit={approval.unit}
              note="Median, submission to approval or decline"
            />
            <Stat
              label="Open reports"
              value={measure(counts?.openReports)}
              note={
                counts?.oldestOpenReportAt
                  ? `Oldest filed ${fmtRelativeLower(counts.oldestOpenReportAt, today)}`
                  : counts
                    ? "Nothing waiting"
                    : undefined
              }
            />
            <Stat
              label="Answered within 7 days"
              value={measure(counts?.answeredWithin7DaysPct)}
              unit={counts?.answeredWithin7DaysPct != null ? "%" : undefined}
              note={counts ? `Of ${plural(counts.requestsSent, "mentorship request")} sent` : undefined}
            />
            <Stat
              label="Inactive 6 months"
              value={measure(counts?.membersInactive6Months)}
              note="Members not seen since, for a check-in"
            />
          </div>
          <p className="t-small mt-4">
            <Link to="/admin/mentorship" className="link link-quiet">
              See mentorship activity by month and topic
            </Link>
          </p>
        </div>
      )}

      <div className="pn-split mt-8">
        <Card
          accent
          title="Approval queue"
          aside={
            <Link to="/admin/queue" className="link link-quiet t-small">
              Open the queue
            </Link>
          }
        >
          {queue.isError ? (
            <Notice tone="warn">{adminErrorText(queue.error)}</Notice>
          ) : queue.data && queue.data.items.length > 0 ? (
            <>
              <ul className="grid gap-3">
                {queue.data.items.map((r) => (
                  <li key={r.id} className="flex items-center gap-3">
                    <Monogram initials={personInitials(r)} size="sm" />
                    <Link to={`/admin/queue/${r.id}`} className="link link-quiet min-w-0 truncate">
                      {personName(r)}
                    </Link>
                    <span className="t-small text-fg-2 ml-auto whitespace-nowrap">
                      {fmtRelative(r.submittedAt, today)}
                    </span>
                  </li>
                ))}
              </ul>
              {queue.data.total > queue.data.items.length ? (
                <p className="t-small text-fg-2 mt-4">
                  {plural(queue.data.total - queue.data.items.length, "more submission")} waiting.
                </p>
              ) : null}
            </>
          ) : queue.data ? (
            <Empty inline title="The queue is empty." />
          ) : (
            <p className="t-small text-fg-2">Loading the queue</p>
          )}
        </Card>

        <Card title="Expertise tags">
          {tags.data ? (
            tags.data.total > 0 ? (
              <>
                <p className="t-body">
                  {plural(tags.data.total, "proposed tag")} waiting for a decision. Members see their own proposed
                  tags; everyone else sees them once approved.
                </p>
                <Link to="/admin/vocabulary" className="btn btn-outline btn-sm mt-4">
                  Review tags
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </>
            ) : (
              <p className="t-small text-fg-2">No proposed tags are waiting.</p>
            )
          ) : tags.isError ? (
            <Notice tone="warn">{adminErrorText(tags.error)}</Notice>
          ) : (
            <p className="t-small text-fg-2">Loading tags</p>
          )}
        </Card>
      </div>
    </>
  );
}
