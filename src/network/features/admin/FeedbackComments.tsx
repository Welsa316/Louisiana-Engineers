/**
 * What members said after a relationship ended (Task 32), on the mentorship
 * activity screen: the comments from `GET /api/admin/feedback`, newest
 * quarter first. Each one says which side wrote it, the quarter and the
 * rating, and nothing that names a person or a relationship. Only an
 * administrator for every region reads them; a chapter administrator sees a
 * note saying so. Comments about a relationship the reader was part of are
 * never listed.
 */

import { useState } from "react";
import { isApiError } from "../../lib/api";
import { Card, Empty, Notice } from "../../ui/ui";
import { Pager } from "../../ui/admin-controls";
import { HELPFUL_LABELS } from "../../ui/feedback-scale";
import { FEEDBACK_PAGE_SIZE, useAdminFeedback } from "../feedback/api";
import { adminErrorText } from "./api";
import "../../ui/feedback.css";

const QUARTER_MONTHS = ["January to March", "April to June", "July to September", "October to December"];

/** "2026-Q4" as "October to December 2026". */
function quarterLabel(quarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return match ? `${QUARTER_MONTHS[Number(match[2]) - 1]} ${match[1]}` : quarter;
}

export function FeedbackComments() {
  const [page, setPage] = useState(1);
  const list = useAdminFeedback(page);
  const data = list.data;

  return (
    <Card flush title="What members said">
      {isApiError(list.error, "out_of_region") ? (
        <div className="p-5">
          <Notice tone="info">
            Members' comments are shown only to administrators for every region.
          </Notice>
        </div>
      ) : list.isError ? (
        <div role="alert" className="p-5">
          <Notice tone="warn">{adminErrorText(list.error)}</Notice>
        </div>
      ) : !data ? (
        <p className="t-small text-fg-2 p-5" role="status">
          Loading the comments
        </p>
      ) : data.items.length === 0 ? (
        <div className="p-5">
          <Empty inline title="No comments yet.">
            Comments appear here once members answer after a mentorship ends.
          </Empty>
        </div>
      ) : (
        <>
          <ul className="pn-feedback-comments" aria-busy={list.isFetching || undefined}>
            {data.items.map((item) => (
              <li key={item.id} className="pn-feedback-comment">
                <span className="pn-feedback-comment-meta">
                  <span>{item.authorRole === "mentee" ? "From a mentee" : "From a mentor"}</span>
                  <span>
                    {item.helpful} of 5, {HELPFUL_LABELS[item.helpful]?.toLowerCase() ?? ""}
                  </span>
                  <span>{quarterLabel(item.quarter)}</span>
                </span>
                <p className="t-body">{item.comment}</p>
              </li>
            ))}
          </ul>
          <Pager page={page} size={FEEDBACK_PAGE_SIZE} total={data.total} onPage={setPage} label="Comment pages" />
        </>
      )}
    </Card>
  );
}
