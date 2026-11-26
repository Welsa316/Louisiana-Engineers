/**
 * The notification list, relative to `/network`, and the pieces the app
 * shell mounts. The orchestrator spreads `notificationRoutes` into
 * `memberPages` in src/network/app/routes.tsx in place of the
 * `notifications` stub, and mounts the bell and the unread badge on the
 * shell, either by setting `appHeaderSlot` to `notificationHeaderSlot` and
 * merging `useNotificationBadges()` into the badges, or by rendering
 * `NotificationsAppLayout` where `AppLayout` is rendered today.
 */

import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import type { NavBadges } from "../../app/nav";
import { AppLayout } from "../../app/shells";
import { Bell } from "./Bell";
import { NotificationList } from "./List";
import { useUnreadCount } from "./api";

export const notificationRoutes: RouteObject[] = [{ path: "notifications", element: <NotificationList /> }];

/** The control for the app shell's `headerSlot`. */
export const notificationHeaderSlot: ReactNode = <Bell />;

/** The Notifications item's badge (rail, tab bar and Menu sheet): the unread count. */
export function useNotificationBadges(): NavBadges {
  const unread = useUnreadCount();
  return unread ? { notifications: unread } : {};
}

/**
 * `AppLayout` with the bell in its header and the unread count on the
 * Notifications item, merged over any other badges and header controls.
 */
export function NotificationsAppLayout({ headerSlot, badges }: { headerSlot?: ReactNode; badges?: NavBadges }) {
  const notificationBadges = useNotificationBadges();
  return (
    <AppLayout
      headerSlot={
        <>
          {headerSlot}
          <Bell />
        </>
      }
      badges={{ ...badges, ...notificationBadges }}
    />
  );
}
