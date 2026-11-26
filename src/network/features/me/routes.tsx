/**
 * The member home, relative to `/network`. The orchestrator spreads
 * `meRoutes` into `memberPages` in src/network/app/routes.tsx in place of the
 * `me/*` stub, beside the other `me/...` routes (Task 15's
 * `discover-routes.tsx`, and the requests and saved pages from Phase 1C).
 * `me` matches `/network/me` exactly, so those siblings never collide.
 */

import type { RouteObject } from "react-router";
import { Home } from "./Home";

export const meRoutes: RouteObject[] = [{ path: "me", element: <Home /> }];
