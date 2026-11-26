/**
 * The approval queue (03 section 8.1): open submissions oldest first, with
 * tabs for the ones sent back for changes and the ones listed. A row opens
 * the review drawer at `/admin/queue/:reviewId`; the tab and page ride in
 * the query string so closing the drawer returns to the same list.
 */

import { ArrowRight } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { adminReviewStatuses, type AdminReviewItem, type AdminReviewStatus } from "@shared/types/admin";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Monogram, Notice, PageHead, Tabs, Toast, fmtDate, plural } from "../../ui/ui";
import { ADMIN_PAGE_SIZE, adminErrorText, daysSince, personInitials, personName, useReviews } from "./api";
import { ReviewDrawer } from "./ReviewDrawer";

/** Tab order: the queue, then what was sent back, then what was listed. */
const TAB_ORDER: AdminReviewStatus[] = ["pending", "declined", "approved"];

const TAB_LABELS: Record<AdminReviewStatus, string> = {
  pending: "Waiting",
  declined: "Needs changes",
  approved: "Listed",
};

const EMPTY: Record<AdminReviewStatus, { title: string; body?: string }> = {
  pending: { title: "The queue is empty.", body: "New professional profiles land here as they are submitted." },
  declined: { title: "Nothing sent back for changes." },
  approved: { title: "Nothing approved yet." },
};

export interface QueueFlash {
  flash: string;
}

function statusFrom(value: string | null): AdminReviewStatus {
  return (adminReviewStatuses as readonly string[]).includes(value ?? "") ? (value as AdminReviewStatus) : "pending";
}

export function Approvals() {
  useMeta({ title: "Approval queue" });
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const status = statusFrom(params.get("status"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useReviews(status, page);
  const counts = {
    pending: useReviews("pending", 1, 1).data?.total,
    declined: useReviews("declined", 1, 1).data?.total,
    approved: useReviews("approved", 1, 1).data?.total,
  };
  const flash = (location.state as QueueFlash | null)?.flash;
  const search = params.toString() ? `?${params.toString()}` : "";

  const setTab = (next: AdminReviewStatus) => setParams(next === "pending" ? {} : { status: next });
  const setPage = (next: number) =>
    setParams({ ...(status === "pending" ? {} : { status }), ...(next > 1 ? { page: String(next) } : {}) });
  const open = (r: AdminReviewItem) => navigate(`/admin/queue/${r.id}${search}`);

  return (
    <>
      <PageHead
        kicker="Approval queue"
        title="Profiles waiting to be listed."
        lead="Read each submission as a member would. Approve a real person in a STEM role with a sensible bio. Declining sends your notes to the member, who can edit and submit again."
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      <div className="mt-8">
        <Tabs
          label="Submissions"
          value={status}
          onChange={setTab}
          tabs={TAB_ORDER.map((id) => ({ id, label: TAB_LABELS[id], count: counts[id] }))}
        />
      </div>

      <Card flush className="mt-6">
        {list.isError ? (
          <div className="p-5" role="alert">
            <Notice tone="warn">{adminErrorText(list.error)}</Notice>
          </div>
        ) : !list.data ? (
          <p className="p-5 t-small text-fg-2">Loading submissions</p>
        ) : list.data.items.length === 0 ? (
          <div className="p-5">
            <Empty inline title={EMPTY[status].title}>
              {EMPTY[status].body}
            </Empty>
          </div>
        ) : (
          <>
            <div className="pn-table-wrap">
              <table className="pn-table">
                <caption className="sr-only">
                  {TAB_LABELS[status]}: {plural(list.data.total, "submission")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Discipline</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">{status === "pending" ? "Waiting" : "Decided"}</th>
                    <th scope="col">Signals</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="pn-table-person">
                          <Monogram initials={personInitials(r)} size="sm" />
                          <div className="min-w-0">
                            <strong>{personName(r)}</strong>
                            <span>{[r.title, r.organization].filter(Boolean).join(" · ")}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Discipline">{r.disciplineLabel ?? "Not given"}</td>
                      <td data-label="Submitted">{fmtDate(r.submittedAt, true)}</td>
                      <td data-label={status === "pending" ? "Waiting" : "Decided"}>
                        {status === "pending"
                          ? plural(daysSince(r.submittedAt), "day")
                          : r.decidedAt
                            ? fmtDate(r.decidedAt, true)
                            : ""}
                      </td>
                      <td data-label="Signals">
                        <div className="flex flex-wrap gap-2">
                          {r.wantsToMentor ? <span className="pn-tag pn-tag-quiet">Wants to mentor</span> : null}
                          {r.verified ? <span className="pn-tag pn-tag-quiet">Verified</span> : null}
                          {r.previousReviews > 0 ? <span className="pn-tag pn-tag-quiet">Resubmitted</span> : null}
                          {status === "declined" && r.approvalState === "pending" ? (
                            <span className="pn-tag pn-tag-quiet">Waiting again</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="pn-table-actions">
                          <button type="button" className="btn btn-outline btn-xs" onClick={() => open(r)}>
                            {status === "pending" ? "Review" : "Open"}
                            <span className="sr-only"> {personName(r)}</span>
                            <ArrowRight size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} size={ADMIN_PAGE_SIZE} total={list.data.total} onPage={setPage} label="Submission pages" />
          </>
        )}
      </Card>

      {/* Keyed by review, so notes typed for one submission never carry to the next. */}
      <ReviewDrawer
        key={reviewId ?? "closed"}
        reviewId={reviewId}
        onClose={() => navigate(`/admin/queue${search}`)}
        onDecided={(text) => navigate(`/admin/queue${search}`, { state: { flash: text } satisfies QueueFlash })}
      />
    </>
  );
}
