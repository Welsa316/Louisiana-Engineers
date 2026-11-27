/**
 * The public directory and profile pages, relative to `/network`. The
 * orchestrator spreads these into `publicPages` in src/network/app/routes.tsx
 * in place of the `directory` and `directory/:id` stubs.
 */

import type { RouteObject } from "react-router";
import { Directory } from "./Directory";
import { Profile } from "./Profile";
import { reportSlot } from "./ReportDialog";

export const directoryRoutes: RouteObject[] = [
  { path: "directory", element: <Directory /> },
  { path: "directory/:id", element: <Profile reportSlot={reportSlot} /> },
];
