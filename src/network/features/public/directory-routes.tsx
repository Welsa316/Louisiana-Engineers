/**
 * The public directory and profile pages, relative to `/network`. The
 * orchestrator spreads these into `publicPages` in src/network/app/routes.tsx
 * in place of the `directory` and `directory/:id` stubs. A signed-in
 * member gets Task 22's request buttons through the profile's `slot`.
 */

import type { RouteObject } from "react-router";
import { requestSlot } from "../me/RequestActions";
import { Directory } from "./Directory";
import { Profile } from "./Profile";
import { reportSlot } from "./ReportDialog";

export const directoryRoutes: RouteObject[] = [
  { path: "directory", element: <Directory /> },
  { path: "directory/:id", element: <Profile slot={requestSlot} reportSlot={reportSlot} /> },
];
