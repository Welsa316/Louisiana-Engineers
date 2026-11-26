import type { NotificationCategory } from "@shared/types/common";
import type {
  MarkAllReadResponse,
  MarkReadResponse,
  NotificationItem,
  NotificationsResponse,
} from "@shared/types/notifications";
import type { Db } from "../db/tx";
import { AppError } from "../http/errors";

/**
 * The in-app notification list (NOT-2). Notifications are written only by
 * `create_notification` inside definer functions and jobs; here the
 * recipient reads them and stamps `read_at`, the one column `app_user` may
 * update, under the recipient-only policies from migration 0003. Every
 * statement also names `app_uid()` so the scope does not rest on the
 * policies alone.
 */

export interface ListArgs {
  unreadOnly: boolean;
  page: number;
  size: number;
}

interface NotificationRow {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  created_at: Date;
  read_at: Date | null;
}

const COLUMNS = "id, category::text AS category, title, body, link, created_at, read_at";

function item(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  };
}

export async function listNotifications(db: Db, { unreadOnly, page, size }: ListArgs): Promise<NotificationsResponse> {
  const rows = await db.query<NotificationRow>(
    `SELECT ${COLUMNS}
       FROM notifications
      WHERE recipient_id = app_uid() AND ($1::boolean IS FALSE OR read_at IS NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [unreadOnly, size, (page - 1) * size],
  );
  const counts = await db.one<{ total: number; unread: number }>(
    `SELECT count(*) FILTER (WHERE $1::boolean IS FALSE OR read_at IS NULL)::int AS total,
            count(*) FILTER (WHERE read_at IS NULL)::int AS unread
       FROM notifications
      WHERE recipient_id = app_uid()`,
    [unreadOnly],
  );
  return { items: rows.map(item), total: counts.total, unread: counts.unread };
}

/** Marks one of the caller's notifications read; a second call keeps the first time. Someone else's is a 404. */
export async function markRead(db: Db, id: string): Promise<MarkReadResponse> {
  const row = await db.maybeOne<{ id: string; read_at: Date }>(
    `UPDATE notifications
        SET read_at = coalesce(read_at, now())
      WHERE id = $1 AND recipient_id = app_uid()
      RETURNING id, read_at`,
    [id],
  );
  if (!row) throw new AppError(404, "not_found", "notification not found for the caller");
  return { id: row.id, readAt: row.read_at.toISOString() };
}

export async function markAllRead(db: Db): Promise<MarkAllReadResponse> {
  const result = await db.client.query(
    "UPDATE notifications SET read_at = now() WHERE recipient_id = app_uid() AND read_at IS NULL",
  );
  return { updated: result.rowCount ?? 0 };
}
