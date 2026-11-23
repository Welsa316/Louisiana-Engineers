/**
 * Sign-in routes, relative to `/network`. The orchestrator spreads these into
 * `publicPages` in src/network/app/routes.tsx in place of the stubs for
 * `signin`, `check-email`, `join` and `scheduled-for-deletion`.
 */

import type { RouteObject } from "react-router";
import { CheckEmail } from "./CheckEmail";
import { Join } from "./Join";
import { ScheduledForDeletion } from "./ScheduledForDeletion";
import { SignIn } from "./SignIn";

export const authRoutes: RouteObject[] = [
  { path: "signin", element: <SignIn /> },
  { path: "check-email", element: <CheckEmail /> },
  { path: "join", element: <Join /> },
  { path: "scheduled-for-deletion", element: <ScheduledForDeletion /> },
];
