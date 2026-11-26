/**
 * Find mentors inside the app shell, relative to `/network`: the directory
 * with "Available to mentor now" preset, and its profiles. The orchestrator
 * spreads these into `memberPages` in src/network/app/routes.tsx, ahead of
 * the `me/*` catch-all (React Router ranks the specific paths first either
 * way). Task 22 can pass `slot` to `Profile` here for the request buttons.
 */

import type { RouteObject } from "react-router";
import { Directory } from "../public/Directory";
import { Profile } from "../public/Profile";

export const discoverRoutes: RouteObject[] = [
  { path: "me/discover", element: <Directory mode="discover" /> },
  { path: "me/discover/:id", element: <Profile mode="discover" /> },
];
