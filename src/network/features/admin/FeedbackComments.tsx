/**
 * What members said after a relationship ended (Task 32), on the mentorship
 * activity screen: the comments from `GET /api/admin/feedback`, newest
 * first. Each one says which side wrote it, the month and the rating, and
 * nothing that names a person or a relationship.
 */

import { useState } from "react";
import { Card, Empty, Notice } from "../../ui/ui";
import { Pager } from "../../ui/admin-controls";
import { HELPFUL_LABELS } from "../../ui/feedback-scale";
import { FEEDBACK_PAGE_SIZE, useAdminFeedback } from "../feedback/api";
import { adminErrorText } from "./api";
import { monthLabel } from "./measures";
import "../../ui/feedback.css";

export function FeedbackComments() {
  const [page, setPage] = useState(1);
  const list = useAdminFeedback(page);
  const data = list.data;

  return (
    <Card flush title="What members said">
      {list.isError ? (
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
                  <span>
                    {item.kind === "introduction" ? "Introduction" : "Mentorship"}, {monthLabel(item.month)}
                  </span>
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
