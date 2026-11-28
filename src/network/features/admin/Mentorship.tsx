/**
 * Mentorship activity (03 section 8.4): the request and relationship
 * measures from `admin_dashboard` (migration 0009), the last three months as
 * a table with month columns (it prints well for a board meeting), and which
 * topics mentees ask about. Aggregates only: no request, person or text.
 * Post-completion feedback (Task 32) adds the average helpfulness, the
 * number of answers and the comments, none of them tied to a person. The
 * two measures wait for 5 answers and leave out answers about the viewer's
 * own mentorships, so no single answer can be worked out from them.
 */

import type { AdminDashboard } from "@shared/types/admin";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Notice, PageHead, Stat, plural } from "../../ui/ui";
import { adminErrorText, useAdminDashboard } from "./api";
import { FeedbackComments } from "./FeedbackComments";
import { measure, monthLabel, trim } from "./measures";

/** What the two feedback measures say while they wait for enough answers. */
const FEEDBACK_HELD = "Shown after 5 answers";

type MonthKey = Exclude<keyof AdminDashboard["byMonth"][number], "month">;

const MONTH_ROWS: { key: MonthKey; label: string }[] = [
  { key: "requestsSent", label: "Requests sent" },
  { key: "answeredWithin7Days", label: "Answered within 7 days" },
  { key: "expired", label: "Expired" },
  { key: "completedRelationships", label: "Relationships completed" },
];

export function Mentorship() {
  useMeta({ title: "Mentorship activity" });
  const dashboard = useAdminDashboard();
  const d = dashboard.data;

  return (
    <>
      <PageHead
        kicker="Mentorship activity"
        title="Is the program working?"
        lead="Aggregates for the board report. The content of requests is never shown here, and no mentor is rated."
      />

      {dashboard.isError ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{adminErrorText(dashboard.error)}</Notice>
        </div>
      ) : (
        <div aria-busy={dashboard.isPending || undefined}>
          <h2 className="t-small text-fg-2 mt-8 mb-3">Requests</h2>
          <div className="pn-stats">
            <Stat
              label="Requests sent"
              value={measure(d?.requestsSent)}
              note={
                d
                  ? d.introductionsSent > 0
                    ? `Mentorship requests, plus ${plural(d.introductionsSent, "introduction")}`
                    : "Mentorship requests; no introductions yet"
                  : undefined
              }
            />
            <Stat
              label="Answered within 7 days"
              value={measure(d?.answeredWithin7DaysPct)}
              unit={d?.answeredWithin7DaysPct != null ? "%" : undefined}
              note="Accepted or declined in the first week"
            />
            <Stat
              label="Acceptance rate"
              value={measure(d?.acceptanceRatePct)}
              unit={d?.acceptanceRatePct != null ? "%" : undefined}
              note="Of the requests a mentor answered"
            />
            <Stat
              label="Expired"
              value={measure(d?.expiryRatePct)}
              unit={d?.expiryRatePct != null ? "%" : undefined}
              note="Mentees who heard nothing in time"
            />
          </div>

          <h2 className="t-small text-fg-2 mt-8 mb-3">Mentoring</h2>
          <div className="pn-stats">
            <Stat label="Active mentors" value={measure(d?.activeMentors)} note="Taking requests, with a free slot" />
            <Stat
              label="Paused mentors"
              value={measure(d?.pausedMentors)}
              note={
                d?.medianPausedDays != null
                  ? `Paused for ${trim(d.medianPausedDays)} ${d.medianPausedDays === 1 ? "day" : "days"} (median)`
                  : "Resting, with a resume date or without"
              }
            />
            <Stat label="Active relationships" value={measure(d?.activeRelationships)} note="Accepted and not yet completed" />
            <Stat label="Completed" value={measure(d?.completedRelationships)} note="Relationships that reached an end" />
          </div>

          <h2 className="t-small text-fg-2 mt-8 mb-3">Feedback</h2>
          <div className="pn-stats">
            <Stat
              label="Average helpfulness"
              value={
                d?.feedbackAverageHelpful != null ? trim(d.feedbackAverageHelpful) : measure(d?.feedbackAverageHelpful, FEEDBACK_HELD)
              }
              unit={d?.feedbackAverageHelpful != null ? "of 5" : undefined}
              note="1 is not helpful, 5 is very helpful"
            />
            <Stat
              label="Answers"
              value={measure(d?.feedbackResponses, FEEDBACK_HELD)}
              note="From mentees and mentors, after a relationship ends"
            />
          </div>
        </div>
      )}

      {d ? (
        <div className="pn-split mt-8">
          <Card flush title="The last three months">
            <div className="pn-table-wrap">
              <table className="pn-table pn-admin-measures pn-admin-months">
                <caption className="sr-only">Mentorship requests by the month they were sent</caption>
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    {d.byMonth.map((m, i) => (
                      <th scope="col" key={m.month} className="pn-num">
                        {monthLabel(m.month)}
                        {i === d.byMonth.length - 1 ? <span className="sr-only"> (so far)</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MONTH_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">
                        {row.label}
                      </th>
                      {d.byMonth.map((m) => (
                        <td key={m.month} className="pn-num" data-label={monthLabel(m.month)}>
                          {m[row.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="t-small text-fg-2 px-5 py-4">
              Requests count in the month they were sent, so the current month fills in as answers arrive.
            </p>
          </Card>

          <Card flush title="Requests by topic">
            {d.requestsByTopic.length === 0 ? (
              <div className="p-5">
                <Empty inline title="No mentorship requests yet." />
              </div>
            ) : (
              <div className="pn-table-wrap">
                <table className="pn-table pn-admin-measures pn-admin-topics">
                  <caption className="sr-only">Mentorship requests by topic, most requested first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Topic</th>
                      <th scope="col" className="pn-num">
                        Requests
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.requestsByTopic.map((t) => (
                      <tr key={t.topicId}>
                        <th scope="row">
                          {t.label}
                        </th>
                        <td className="pn-num" data-label="Requests">
                          {t.requests}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <div className="mt-8">
        <FeedbackComments />
      </div>

      <p className="pn-admin-measures-note t-small text-fg-2 mt-8">
        Every measure counts mentorship requests; introductions are counted only on their own. A request counts toward
        the 7-day share once its first week is over or a mentor has answered it. Canceled requests, and requests closed
        because a member left, count toward neither the 7-day share nor the acceptance rate. The expired share is of
        every request no longer waiting for an answer. Feedback is shown without names: a comment says only which side
        wrote it and the quarter. The feedback measures appear once there are 5 answers, and none of them counts
        answers about a mentorship you took part in.
      </p>
    </>
  );
}
