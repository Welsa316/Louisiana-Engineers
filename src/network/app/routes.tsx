/**
 * Every route of the MEST Network, relative to the `/network` basename.
 *
 * Orchestrator-owned: each feature exports `RouteObject[]` from
 * `src/network/features/<area>/routes.tsx`, and the integrate step spreads it
 * into the matching list below in place of that area's stub. Layout and
 * guards stay here, so a feature never decides who may see it:
 *
 *   publicPages      anyone, public shell
 *   onboardingPages  signed in, onboarding not required, public shell
 *   memberPages      signed-in member who finished onboarding, app shell
 *   adminPages       administrators, app shell
 */

import type { ReactNode } from "react";
import { Outlet, type RouteObject } from "react-router";
import { authRoutes } from "../features/auth/routes";
import { publicRoutes } from "../features/public/routes";
import { Stub } from "../features/public/Stub";
import { RequireAdmin, RequireMember, RequireOnboarded } from "./guards";
import type { NavBadges } from "./nav";
import { AppLayout, NotFoundPage, PublicLayout } from "./shells";

/** Controls mounted in the app shell's header (Task 18 mounts the notification bell here). */
const appHeaderSlot: ReactNode = null;

/** Rail and tab bar counts (requests waiting, unread notifications), once their tasks land. */
const appBadges: NavBadges = {};

/* Task 9's public and sign-in pages; Task 15 replaces the directory and profile stubs. */
const publicPages: RouteObject[] = [
  ...publicRoutes,
  { path: "directory", element: <Stub title="Directory" /> },
  { path: "directory/:id", element: <Stub title="Profile" /> },
  ...authRoutes,
];

/* Task 14 (features/onboarding) replaces this. */
const onboardingPages: RouteObject[] = [{ path: "onboarding/*", element: <Stub title="Onboarding" /> }];

/* Tasks 15, 16, 18, 22 and 23 (features/me, settings, notifications, mentor) replace these. */
const memberPages: RouteObject[] = [
  { path: "me/*", element: <Stub inApp title="Home" /> },
  { path: "mentor/*", element: <Stub inApp title="Mentoring" /> },
  { path: "settings/*", element: <Stub inApp title="Profile and settings" /> },
  { path: "notifications", element: <Stub inApp title="Notifications" /> },
];

/* Task 17 (features/admin) replaces this. */
const adminPages: RouteObject[] = [{ path: "admin/*", element: <Stub inApp title="Administration" /> }];

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      ...publicPages,
      {
        element: (
          <RequireMember>
            <Outlet />
          </RequireMember>
        ),
        children: onboardingPages,
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: (
      <RequireMember>
        <RequireOnboarded>
          <AppLayout headerSlot={appHeaderSlot} badges={appBadges} />
        </RequireOnboarded>
      </RequireMember>
    ),
    children: [
      ...memberPages,
      {
        element: (
          <RequireAdmin>
            <Outlet />
          </RequireAdmin>
        ),
        children: adminPages,
      },
    ],
  },
];
