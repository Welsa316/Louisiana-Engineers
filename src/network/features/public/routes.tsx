/**
 * Public information pages, relative to `/network`. The orchestrator spreads
 * these into `publicPages` in src/network/app/routes.tsx in place of the
 * stubs for the index, `mentorship`, `guidelines` and `privacy`. The
 * directory and profile stubs stay until Task 15.
 */

import type { RouteObject } from "react-router";
import { Guidelines } from "./Guidelines";
import { Home } from "./Home";
import { Mentorship } from "./Mentorship";
import { Privacy } from "./Privacy";

export const publicRoutes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: "mentorship", element: <Mentorship /> },
  { path: "guidelines", element: <Guidelines /> },
  { path: "privacy", element: <Privacy /> },
];
