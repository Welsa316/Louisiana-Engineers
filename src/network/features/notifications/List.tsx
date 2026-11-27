/**
 * The in-app notification list (`/network/notifications`, NOT-2): everything
 * the platform has told this account, newest first, with read state. The
 * list cannot be turned off (NOT-3); email preferences live in settings.
 * `NotificationRows` is shared with Home's "Latest" card.
 */

import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { Link } from "react-router";
import type { NotificationItem } from "@shared/types/notifications";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Notice, PageHead, Tabs, fmtRelative, plural } from "../../ui/ui";
import "../../ui/notifications.css";
import { NOTIFICATIONS_PAGE_SIZE, appPath, useMarkAllRead, useMarkRead, useNotifications } from "./api";

export function notificationErrorText(error: unknown): string {
  if (isApiError(error, "network")) return "The notifications could not be loaded. Check your connection and try again.";
  if (isApiError(error, "unauthenticated")) return "Your session has ended. Sign in again to see your notifications.";
  return "The notifications could not be loaded. Try again in a moment.";
}

function NotificationTitle({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  if (!item.link) return <p className="pn-note-title">{item.title}</p>;
  const { to, inRouter } = appPath(item.link);
  return inRouter ? (
    <Link to={to} className="pn-note-title" onClick={onOpen}>
      {item.title}
    </Link>
  ) : (
    <a href={to} className="pn-note-title" onClick={onOpen}>
      {item.title}
    </a>
  );
}

/**
 * Notification rows. Opening a linked one marks it read on the way; an
 * unread one without a link gets its own "Mark as read" button.
 */
export function NotificationRows({ items }: { items: NotificationItem[] }) {
  const markRead = useMarkRead();
  const today = new Date().toISOString();
  return (
    <ul className="pn-ledger">
      {items.map((item) => {
        const unread = item.readAt === null;
        const open = () => {
          if (unread) markRead.mutate(item.id);
        };
        return (
          <li key={item.id} className="pn-note" data-unread={unread}>
            <span className="pn-note-dot" aria-hidden="true" />
            <div className="min-w-0">
              {unread ? <span className="sr-only">Unread: </span> : null}
              <NotificationTitle item={item} onOpen={open} />
              {item.body ? <p className="pn-note-body">{item.body}</p> : null}
            </div>
            <div className="pn-note-side">
              <time className="pn-note-when" dateTime={item.createdAt}>
                {fmtRelative(item.createdAt, today)}
              </time>
              {unread && !item.link ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={markRead.isPending && markRead.variables === item.id}
                  onClick={open}
                >
                  Mark as read
                  <span className="sr-only">: {item.title}</span>
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Filter = "all" | "unread";

export function NotificationList() {
  useMeta({ title: "Notifications" });
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const list = useNotifications(filter === "unread", page, NOTIFICATIONS_PAGE_SIZE);
  const markAll = useMarkAllRead();
  const unread = list.data?.unread ?? 0;

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <>
      <PageHead
        kicker="Notifications"
        title="What has happened on your account."
        lead="Requests, replies, reminders and decisions about your profile. Which of these also reach you by email is up to you in settings."
        actions={
          <Link to="/settings/notifications" className="btn btn-outline btn-sm">
            Email preferences
          </Link>
        }
      />

      <div className="pn-note-toolbar mt-8">
        <Tabs<Filter>
          label="Show"
          value={filter}
          onChange={changeFilter}
          tabs={[
            { id: "all", label: "All" },
            { id: "unread", label: "Unread", count: list.data ? unread : undefined },
          ]}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck size={15} aria-hidden="true" />
          Mark all as read
        </button>
      </div>

      {markAll.isError ? (
        <div role="alert" className="mt-4">
          <Notice tone="warn">Marking them read did not go through. Try again in a moment.</Notice>
        </div>
      ) : null}

      <div className="mt-6" aria-busy={list.isFetching || undefined}>
      <Card flush className="px-5">
        {list.isError ? (
          <div role="alert" className="py-5">
            <Notice tone="warn">{notificationErrorText(list.error)}</Notice>
          </div>
        ) : list.data ? (
          list.data.items.length > 0 ? (
            <>
              <h2 className="sr-only">
                {filter === "unread" ? plural(list.data.total, "unread notification") : plural(list.data.total, "notification")}
              </h2>
              <NotificationRows items={list.data.items} />
              <Pager
                page={page}
                size={NOTIFICATIONS_PAGE_SIZE}
                total={list.data.total}
                onPage={setPage}
                label="Notification pages"
              />
            </>
          ) : (
            <Empty inline title="Nothing new.">
              {filter === "unread" && page === 1 ? "You have read everything." : undefined}
            </Empty>
          )
        ) : (
          <p className="t-small text-fg-2 py-5">Loading notifications</p>
        )}
      </Card>
      </div>
    </>
  );
}
