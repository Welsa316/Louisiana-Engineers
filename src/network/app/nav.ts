/**
 * The signed-in navigation (03 section 3.2), derived from the session: the
 * desktop rail in groups, the phone tab bar's four destinations, and the
 * rest of the items for the phone's Menu sheet. Paths are relative to the
 * router's `/network` basename.
 *
 * Owned by the orchestrator once Phase 1A lands: feature tasks that need an
 * item say so in their hand-off instead of editing this file.
 */

import {
  Bell,
  Bookmark,
  CalendarDays,
  Compass,
  Home,
  Inbox,
  LayoutGrid,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { SessionUser } from "@shared/types/auth";

export type NavItemId =
  | "home"
  | "directory"
  | "find-mentors"
  | "requests"
  | "mentoring"
  | "meetings"
  | "saved"
  | "notifications"
  | "settings"
  | "admin";

export interface NavItem {
  id: NavItemId;
  to: string;
  label: string;
  /** The tab bar's shorter label, when the full one does not fit. */
  tabLabel?: string;
  icon: LucideIcon;
  /** Current only on an exact match (otherwise any path inside `to` counts). */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface Nav {
  /** The desktop rail, in order. */
  groups: NavGroup[];
  /** The phone tab bar; a Menu button follows them. */
  tabs: NavItem[];
  /** Everything not in `tabs`, for the phone Menu sheet. */
  menu: NavItem[];
}

/** Badge counts by item, supplied by whoever renders the shell. */
export type NavBadges = Partial<Record<NavItemId, number>>;

type NavUser = Pick<SessionUser, "kind" | "mentorStatus" | "isAdmin">;

const ITEMS: Record<NavItemId, NavItem> = {
  home: { id: "home", to: "/me", label: "Home", icon: Home, end: true },
  directory: { id: "directory", to: "/directory", label: "Directory", icon: LayoutGrid },
  "find-mentors": { id: "find-mentors", to: "/me/discover", label: "Find mentors", tabLabel: "Mentors", icon: Compass },
  requests: { id: "requests", to: "/me/requests", label: "My requests", tabLabel: "Requests", icon: Inbox },
  mentoring: { id: "mentoring", to: "/mentor", label: "Mentoring", icon: Users },
  meetings: { id: "meetings", to: "/me/meetings", label: "Meetings", icon: CalendarDays },
  saved: { id: "saved", to: "/me/saved", label: "Saved", icon: Bookmark },
  notifications: { id: "notifications", to: "/notifications", label: "Notifications", tabLabel: "Alerts", icon: Bell },
  settings: { id: "settings", to: "/settings", label: "Profile and settings", tabLabel: "Settings", icon: Settings },
  admin: { id: "admin", to: "/admin", label: "Administration", tabLabel: "Admin", icon: ShieldCheck },
};

/** A professional whose mentorship is on, even while paused, has a mentor inbox. */
export function isMentor(user: NavUser): boolean {
  return user.kind === "professional" && (user.mentorStatus === "active" || user.mentorStatus === "paused");
}

export function navFor(user: NavUser): Nav {
  const mentor = isMentor(user);

  const groups: NavGroup[] = [
    { label: "Network", items: [ITEMS.home, ITEMS.directory, ITEMS["find-mentors"], ITEMS.saved] },
    { label: "Mentorship", items: mentor ? [ITEMS.requests, ITEMS.mentoring, ITEMS.meetings] : [ITEMS.requests, ITEMS.meetings] },
    {
      label: "Account",
      items: user.isAdmin ? [ITEMS.notifications, ITEMS.settings, ITEMS.admin] : [ITEMS.notifications, ITEMS.settings],
    },
  ];

  // Five phone slots: four destinations and Menu. Mentors get Mentoring in
  // the third slot; their own requests stay one tap away in Menu and on Home.
  const tabs = [ITEMS.home, ITEMS.directory, mentor ? ITEMS.mentoring : ITEMS.requests, ITEMS.notifications];
  const inTabs = new Set(tabs.map((t) => t.id));
  const menu = groups.flatMap((g) => g.items).filter((item) => !inTabs.has(item.id));

  return { groups, tabs, menu };
}
