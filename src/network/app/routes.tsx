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
import { adminRoutes } from "../features/admin/routes";
import { authRoutes } from "../features/auth/routes";
import { discoverRoutes } from "../features/me/discover-routes";
import { menteeRoutes } from "../features/me/mentee-routes";
import { meRoutes } from "../features/me/routes";
import { NotificationsAppLayout, notificationRoutes } from "../features/notifications/routes";
import { onboardingRoutes } from "../features/onboarding/routes";
import { directoryRoutes } from "../features/public/directory-routes";
import { publicRoutes } from "../features/public/routes";
import { settingsRoutes } from "../features/settings/routes";
import { Stub } from "../features/public/Stub";
import { RequireAdmin, RequireMember, RequireOnboarded } from "./guards";
import type { NavBadges } from "./nav";
import { NotFoundPage, PublicLayout } from "./shells";

/** Controls mounted in the app shell's header, beside the notification bell. */
const appHeaderSlot: ReactNode = null;

/** Rail and tab bar counts (requests waiting, unread notifications), once their tasks land. */
const appBadges: NavBadges = {};

/* Task 9's public and sign-in pages and Task 15's directory and profile. */
const publicPages: RouteObject[] = [...publicRoutes, ...directoryRoutes, ...authRoutes];

/* Task 14's onboarding wizard. */
const onboardingPages: RouteObject[] = onboardingRoutes;

/* Home, discovery, settings and notifications; Tasks 22 and 23 replace the mentoring stub. */
const memberPages: RouteObject[] = [
  ...meRoutes,
  ...discoverRoutes,
  ...menteeRoutes,
  { path: "mentor/*", element: <Stub inApp title="Mentoring" /> },
  ...settingsRoutes,
  ...notificationRoutes,
];

/* Task 17 (features/admin) replaces this. */
const adminPages: RouteObject[] = adminRoutes;

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
          <NotificationsAppLayout headerSlot={appHeaderSlot} badges={appBadges} />
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
