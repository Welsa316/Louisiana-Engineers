/**
 * The notification bell in the app shell's header (mounted through the
 * shell's `headerSlot`, Task 8). A link to the list with the unread count;
 * the count is announced as part of the link's name, so it is never just a
 * number to a screen reader.
 */

import { Bell as BellIcon } from "lucide-react";
import { NavLink } from "react-router";
import "../../ui/notifications.css";
import { useUnreadCount } from "./api";

/** Above this the badge shows "99+". */
const MAX_SHOWN = 99;

export function bellLabel(unread: number | undefined): string {
  if (!unread) return "Notifications";
  return `Notifications, ${unread} unread`;
}

export function Bell() {
  const unread = useUnreadCount();
  return (
    <NavLink to="/notifications" className="pn-icon-btn pn-bell" aria-label={bellLabel(unread)} title="Notifications">
      <BellIcon size={20} aria-hidden="true" />
      {unread ? (
        <span className="pn-bell-count" aria-hidden="true">
          {unread > MAX_SHOWN ? `${MAX_SHOWN}+` : unread}
        </span>
      ) : null}
    </NavLink>
  );
}
