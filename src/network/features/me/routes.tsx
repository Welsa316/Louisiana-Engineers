/**
 * The member home, relative to `/network`. The orchestrator spreads
 * `meRoutes` into `memberPages` in src/network/app/routes.tsx in place of the
 * `me/*` stub, beside the other `me/...` routes (Task 15's
 * `discover-routes.tsx`, and the requests and saved pages from Phase 1C).
 * `me` matches `/network/me` exactly, so those siblings never collide.
 *
 * The meetings log (`me/meetings`, Task 31) rides along from
 * features/meetings/routes.tsx.
 */

import type { RouteObject } from "react-router";
import { meetingRoutes } from "../meetings/routes";
import { Home } from "./Home";

export const meRoutes: RouteObject[] = [{ path: "me", element: <Home /> }, ...meetingRoutes];
