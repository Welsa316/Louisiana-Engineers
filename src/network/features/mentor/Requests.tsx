/**
 * The mentor inbox (`/network/mentor/requests`, 03 section 7.1), ported from
 * the prototype's incoming requests screen. Three tabs: Requests (waiting,
 * oldest first so the one closest to expiry is on top, with days left),
 * Active (accepted, not completed) and Past (completed, declined, no reply,
 * withdrawn). The tab lives in the URL (`?show=active|past`, `&page=`) so
 * Back and a shared link keep it. The header carries the capacity line and
 * a link to the mentorship settings.
 *
 * `/network/mentor/requests/:id` opens that request in `RequestDrawer` over
 * the inbox; a request notification links there. Only the two parties can
 * read a request: anyone else gets the "not available" page, and the
 * mentee of a request is sent to their own view of it.
 *
 * Also the small helpers the other mentor screens share (the capacity line,
 * days left, the not-available page), so they read the same everywhere.
 */

import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Settings } from "lucide-react";
import type { RequestStatus } from "@shared/types/common";
import type { RequestSummary } from "@shared/types/requests";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Monogram, Notice, PageHead, Tabs, fmtDate } from "../../ui/ui";
import { topicLabels } from "../public/Directory";
import {
  counterpartyInitials,
  counterpartyName,
  RequestStatusPill,
  requestSubject,
} from "../me/Requests";
import { REQUESTS_PAGE_SIZE, useMyMentorship, useRequest, useRequestList } from "../me/requests-api";
import { useOwnSettings } from "../settings/api";
import { daysLeftLabel, RequestDrawer } from "./RequestDrawer";

/* ---------------------------------------------------------- shared helpers */

export const MENTOR_PENDING: RequestStatus[] = ["pending"];
export const MENTOR_ACTIVE: RequestStatus[] = ["accepted"];
export const MENTOR_PAST: RequestStatus[] = ["completed", "declined", "expired", "canceled"];

/** The date that matters for one of the mentor's rows, mid-sentence. */
export function mentorWhen(r: RequestSummary): string {
  switch (r.status) {
    case "pending":
      return daysLeftLabel(r.expiresAt).toLowerCase();
    case "accepted":
      return r.respondedAt ? `accepted ${fmtDate(r.respondedAt)}` : "accepted";
    case "declined":
      return r.respondedAt ? `declined ${fmtDate(r.respondedAt)}` : "declined";
    case "completed":
      return r.completedAt ? `completed ${fmtDate(r.completedAt)}` : "completed";
    case "canceled":
      return "withdrawn by the member";
    case "expired":
      return `no reply by ${fmtDate(r.expiresAt)}`;
  }
}

/** "1 of 3 active mentees" (03 section 7.1); nothing until the counts load. */
export function CapacityLine({ className }: { className?: string }) {
  const mine = useMyMentorship();
  const m = mine.data;
  if (!m || m.maxActive === null) return null;
  return (
    <p className={["t-small text-fg-2", className].filter(Boolean).join(" ")} data-testid="capacity-line">
      <strong className="text-fg">
        {m.activeCount} of {m.maxActive}
      </strong>{" "}
      active {m.maxActive === 1 ? "mentee" : "mentees"}
    </p>
  );
}

/** One request in a mentor's list. */
export function MentorRequestRow({ r, to }: { r: RequestSummary; to: string }) {
  return (
    <li className="border-b border-[var(--pn-line)] last:border-0">
      <Link to={to} className="pn-row-link !mx-0 !px-5 !rounded-none">
        <Monogram initials={counterpartyInitials(r.counterparty)} size="sm" student={r.counterparty.kind === "student"} />
        <span className="min-w-0">
          <span className="pn-row-title block truncate">{counterpartyName(r.counterparty)}</span>
          <span className="pn-row-meta block">
            {requestSubject(r)} · {mentorWhen(r)}
          </span>
        </span>
        <RequestStatusPill status={r.status} />
      </Link>
    </li>
  );
}

export function MentorBack({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="link link-quiet t-small">
      <ArrowLeft size={14} aria-hidden="true" />
      {label}
    </Link>
  );
}

/** A request the caller is not a party to, or that does not exist. */
export function RequestNotAvailable({ back, label }: { back: string; label: string }) {
  useMeta({ title: "Request not available" });
  return (
    <>
      <MentorBack to={back} label={label} />
      <div className="mt-8 max-w-2xl">
        <h1 className="t-display-sm">This request is not available.</h1>
        <p className="t-body text-fg-2 mt-4">
          The link may be mistyped, or the request belongs to someone else. Requests are visible only to the two people
          in them.
        </p>
      </div>
    </>
  );
}

/** A read that failed for a reason other than "not yours". */
export function isLoadFailure(error: unknown): boolean {
  return isApiError(error, "network") || (isApiError(error) && error.status >= 500);
}

/* ---------------------------------------------------------------- the page */

type Show = "waiting" | "active" | "past";

function readShow(value: string | null): Show {
  return value === "active" || value === "past" ? value : "waiting";
}

function EmptyInbox({ show }: { show: Show }) {
  const settings = useOwnSettings();
  const m = settings.data?.mentorship;
  if (show === "waiting") {
    if (m && m.status === "off") {
      return (
        <Empty
          inline
          title="Mentorship is off."
          action={
            <Link to="/settings/mentorship" className="btn btn-outline btn-sm">
              Turn it on
            </Link>
          }
        >
          Turn it on to receive requests.
        </Empty>
      );
    }
    const topics = m ? topicLabels(m.topics) : [];
    return (
      <Empty
        inline
        title="No requests waiting."
        action={
          <Link to="/settings/mentorship" className="btn btn-outline btn-sm">
            Edit mentorship settings
          </Link>
        }
      >
        {m?.status === "paused"
          ? "Mentorship is paused, so nobody can send you a request until you resume."
          : topics.length > 0
            ? `Your profile says you are taking requests on ${topics.join(", ")}.`
            : "New requests arrive by email and appear here."}
      </Empty>
    );
  }
  return (
    <Empty inline title={show === "active" ? "No active mentees." : "Nothing here yet."}>
      {show === "active"
        ? "Accept a request and it appears here until one of you marks it completed."
        : "Requests you answered, that were withdrawn, or that closed without a reply appear here."}
    </Empty>
  );
}

export function Requests() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const show = readShow(params.get("show"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  useMeta({ title: "Mentoring requests" });

  const waiting = useRequestList("mentor", MENTOR_PENDING, show === "waiting" ? page : 1);
  const active = useRequestList("mentor", MENTOR_ACTIVE, show === "active" ? page : 1);
  const past = useRequestList("mentor", MENTOR_PAST, show === "past" ? page : 1);
  const current = { waiting, active, past }[show];
  const selected = useRequest(id ?? "");

  // The two cases where the drawer is not the answer for a request link.
  if (id && selected.data && selected.data.role === "mentee") {
    return <Navigate to={`/me/requests/${selected.data.id}`} replace />;
  }
  if (id && selected.isError && !isLoadFailure(selected.error)) {
    return <RequestNotAvailable back="/mentor/requests" label="All requests" />;
  }

  const choose = (next: Show) => {
    const search = new URLSearchParams(params);
    if (next === "waiting") search.delete("show");
    else search.set("show", next);
    search.delete("page");
    setParams(search);
  };
  const goTo = (next: number) => {
    const search = new URLSearchParams(params);
    if (next > 1) search.set("page", String(next));
    else search.delete("page");
    setParams(search);
  };
  const search = location.search;
  const closeDrawer = () => navigate(`/mentor/requests${search}`);

  const data = current.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / REQUESTS_PAGE_SIZE)) : 1;

  return (
    <>
      <PageHead
        kicker="Requests"
        title="People who asked for your time."
        lead="Each request shows the member's profile and message. Accepting shares the contact methods you choose; declining sends your reason and note, nothing else."
        actions={
          <Link to="/settings/mentorship" className="btn btn-outline btn-sm">
            <Settings size={15} aria-hidden="true" />
            Mentorship settings
          </Link>
        }
      />
      <CapacityLine className="mt-4" />
      <div className="mt-8">
        <Tabs
          label="Request status"
          value={show}
          onChange={choose}
          tabs={[
            { id: "waiting", label: "Requests", count: waiting.data?.total },
            { id: "active", label: "Active", count: active.data?.total },
            { id: "past", label: "Past", count: past.data?.total },
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
          <ul aria-label="Requests">
            {data.items.map((r) => (
              <MentorRequestRow key={r.id} r={r} to={`/mentor/requests/${r.id}${search}`} />
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyInbox show={show} />
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

      <RequestDrawer
        id={id}
        detail={id ? selected.data : undefined}
        loadFailed={Boolean(id) && selected.isError}
        onRetry={() => void selected.refetch()}
        onClose={closeDrawer}
      />
    </>
  );
}
