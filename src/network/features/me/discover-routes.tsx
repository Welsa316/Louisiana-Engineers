/**
 * Find mentors inside the app shell, relative to `/network`: the directory
 * with "Available to mentor now" preset, and its profiles. The orchestrator
 * spreads these into `memberPages` in src/network/app/routes.tsx, ahead of
 * the `me/*` catch-all (React Router ranks the specific paths first either
 * way). The profile carries Task 22's request buttons in its `slot`.
 */

import type { RouteObject } from "react-router";
import { Directory } from "../public/Directory";
import { Profile } from "../public/Profile";
import { reportSlot } from "../public/ReportDialog";
import { requestSlot } from "./RequestActions";

export const discoverRoutes: RouteObject[] = [
  { path: "me/discover", element: <Directory mode="discover" /> },
  { path: "me/discover/:id", element: <Profile mode="discover" slot={requestSlot} reportSlot={reportSlot} /> },
];
