/**
 * The mentor's screens, relative to `/network` (Task 23). The orchestrator
 * spreads `mentorRoutes` into `memberPages` in src/network/app/routes.tsx
 * in place of the `mentor/*` stub; that list already sits behind
 * `RequireMember` and `RequireOnboarded`.
 *
 *   mentor                 dashboard
 *   mentor/requests        inbox (Requests, Active, Past)
 *   mentor/requests/:id    one request in a drawer over the inbox; request
 *                          notifications for the mentor link here
 *   mentor/mentees         accepted and completed mentorships
 *   mentor/mentees/:id     one mentorship (`:id` is the request id)
 */

import type { RouteObject } from "react-router";
import { NotFoundPage } from "../../app/shells";
import { Dashboard } from "./Dashboard";
import { Mentees } from "./Mentees";
import { Relationship } from "./Relationship";
import { Requests } from "./Requests";

export const mentorRoutes: RouteObject[] = [
  { path: "mentor", element: <Dashboard /> },
  { path: "mentor/requests", element: <Requests /> },
  { path: "mentor/requests/:id", element: <Requests /> },
  { path: "mentor/mentees", element: <Mentees /> },
  { path: "mentor/mentees/:id", element: <Relationship /> },
  { path: "mentor/*", element: <NotFoundPage inApp /> },
];
