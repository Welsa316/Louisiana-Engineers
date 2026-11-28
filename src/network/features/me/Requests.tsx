/**
 * My requests (`/network/me/requests`, 03 section 6.5), ported from the
 * prototype's tracking screen: the requests the caller sent, as Open
 * (pending, accepted) and Closed (declined, completed, canceled, no reply).
 * The choice lives in the URL (`?show=closed`, `&page=`) so Back and a
 * shared link keep it. Each row opens the request.
 *
 * Also the small copy helpers the other request screens share, so a status
 * or a counterparty reads the same everywhere.
 */

import { Link, useSearchParams } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { RequestStatus } from "@shared/types/common";
import type { RequestCounterparty, RequestSummary } from "@shared/types/requests";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Monogram, Notice, PageHead, Status, Tabs, fmtDate } from "../../ui/ui";
import { topicLabel } from "../../lib/vocabulary";
import { displayName, initialsOf } from "../public/Directory";
import { CLOSED_STATUSES, OPEN_STATUSES, REQUESTS_PAGE_SIZE, useRequestList } from "./requests-api";

/* ------------------------------------------------------------- shared copy */

/** Request status labels (03 section 11.2). */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
  canceled: "Canceled",
  expired: "No reply",
};

export function RequestStatusPill({ status, pill = false }: { status: RequestStatus; pill?: boolean }) {
  return <Status tone={status} label={REQUEST_STATUS_LABEL[status]} pill={pill} />;
}

/** The other party's name; a deleted account reads "Former member". */
export function counterpartyName(c: RequestCounterparty, withCredentials = false): string {
  if (c.former) return "Former member";
  return displayName({ firstName: c.firstName, lastName: c.lastName, credentials: withCredentials ? c.credentials : null });
}

export function counterpartyFirstName(c: RequestCounterparty): string {
  if (c.former) return "this member";
  return c.firstName?.trim() || "this member";
}

export function counterpartyInitials(c: RequestCounterparty): string {
  return c.former ? "FM" : initialsOf(c);
}

/** What the request is about: its topic, or "Introduction". */
export function requestSubject(r: Pick<RequestSummary, "kind" | "topicId" | "topicLabel">): string {
  if (r.kind === "introduction") return "Introduction";
  // The server sends the label; the starting set is only a fallback.
  return r.topicLabel ?? (r.topicId ? topicLabel([], r.topicId) : "Mentorship");
}

/** The date that matters for a row, mid-sentence. */
export function requestWhen(r: RequestSummary): string {
  switch (r.status) {
    case "pending":
      return `expires ${fmtDate(r.expiresAt)}`;
    case "accepted":
      return r.respondedAt ? `accepted ${fmtDate(r.respondedAt)}` : "accepted";
    case "declined":
      return r.respondedAt ? `declined ${fmtDate(r.respondedAt)}` : "declined";
    case "completed":
      return r.completedAt ? `completed ${fmtDate(r.completedAt)}` : "completed";
    case "canceled":
      return `sent ${fmtDate(r.createdAt)}, withdrawn`;
    case "expired":
      return `no reply by ${fmtDate(r.expiresAt)}`;
  }
}

/* --------------------------------------------------------------- the page */

type Show = "open" | "closed";

function RequestRows({ items }: { items: RequestSummary[] }) {
  return (
    <ul aria-label="Requests">
      {items.map((r) => (
        <li key={r.id} className="border-b border-[var(--pn-line)] last:border-0">
          <Link to={`/me/requests/${r.id}`} className="pn-row-link !mx-0 !px-5 !rounded-none">
            <Monogram initials={counterpartyInitials(r.counterparty)} size="sm" />
            <span className="min-w-0">
              <span className="pn-row-title block truncate">{counterpartyName(r.counterparty)}</span>
              <span className="pn-row-meta block">
                {requestSubject(r)} · {requestWhen(r)}
              </span>
            </span>
            <RequestStatusPill status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Requests() {
  useMeta({ title: "My requests" });
  const [params, setParams] = useSearchParams();
  const show: Show = params.get("show") === "closed" ? "closed" : "open";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const open = useRequestList("mentee", OPEN_STATUSES, show === "open" ? page : 1);
  const closed = useRequestList("mentee", CLOSED_STATUSES, show === "closed" ? page : 1);
  const current = show === "open" ? open : closed;

  const choose = (next: Show) => {
    const search = new URLSearchParams(params);
    if (next === "closed") search.set("show", "closed");
    else search.delete("show");
    search.delete("page");
    setParams(search);
  };
  const goTo = (next: number) => {
    const search = new URLSearchParams(params);
    if (next > 1) search.set("page", String(next));
    else search.delete("page");
    setParams(search);
  };

  const data = current.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / REQUESTS_PAGE_SIZE)) : 1;
  const nothingAtAll = open.data?.total === 0 && closed.data?.total === 0;

  return (
    <>
      <PageHead
        kicker="My requests"
        title="Where each request stands."
        lead="A pending request expires if there is no answer in time, and each one shows its date. You can withdraw a pending request at any time."
        actions={
          <Link to="/me/discover" className="btn btn-outline btn-sm">
            Find mentors
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        }
      />
      <div className="mt-8">
        <Tabs
          label="Request status"
          value={show}
          onChange={choose}
          tabs={[
            { id: "open", label: "Open", count: open.data?.total },
            { id: "closed", label: "Closed", count: closed.data?.total },
          ]}
        />
      </div>
      <Card flush className="mt-6">
        {current.isError ? (
          <div className="p-5">
            <Notice tone="warn">
              {isApiError(current.error, "network")
                ? "Your requests did not load. Check your connection and try again."
                : "Your requests did not load. Try again in a moment."}
            </Notice>
          </div>
        ) : !data ? (
          <p className="t-small text-fg-2 p-5" role="status">
            Loading your requests
          </p>
        ) : data.items.length > 0 ? (
          <RequestRows items={data.items} />
        ) : nothingAtAll ? (
          <div className="p-5">
            <Empty
              inline
              title="You have not sent a request yet."
              action={
                <Link to="/me/discover" className="btn btn-outline btn-sm">
                  Browse mentors
                </Link>
              }
            >
              Find someone in the directory whose work you want to learn about.
            </Empty>
          </div>
        ) : (
          <div className="p-5">
            <Empty inline title={show === "closed" ? "Nothing closed yet." : "No open requests."}>
              {show === "closed"
                ? "Requests that were answered, withdrawn or not answered in time appear here."
                : "Requests waiting for an answer, and mentors who accepted you, appear here."}
            </Empty>
          </div>
        )}
      </Card>
      {data && pages > 1 ? (
        <nav className="flex items-center justify-between gap-4 mt-4 t-small" aria-label="Request pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Previous
          </button>
          <span className="text-fg-2">
            Page {Math.min(page, pages)} of {pages}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}
