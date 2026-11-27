/**
 * Response shapes of the in-app notification list (`/api/notifications`,
 * Task 18, NOT-2). A recipient reads only their own notifications; nothing
 * here carries the recipient, the email template, its payload or whether an
 * email went out.
 */

import type { NotificationCategory, Paged } from "./common";

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** An in-app path such as `/network/me`; null when there is nothing to open. */
  link: string | null;
  createdAt: string;
  /** null while unread */
  readAt: string | null;
}

/** `GET /api/notifications?unread=1&page&size`: `total` counts the filtered list, `unread` all unread. */
export interface NotificationsResponse extends Paged<NotificationItem> {
  unread: number;
}

/** `POST /api/notifications/:id/read`: the first time it was read, kept on a second call. */
export interface MarkReadResponse {
  id: string;
  readAt: string;
}

/** `POST /api/notifications/read-all`: how many were unread. */
export interface MarkAllReadResponse {
  updated: number;
}
