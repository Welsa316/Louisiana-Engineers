/**
 * The mentee's request screens and saved profiles, relative to `/network`
 * (Task 22). The orchestrator spreads `menteeRoutes` into `memberPages` in
 * src/network/app/routes.tsx beside `meRoutes` and `discoverRoutes`.
 * `me/requests/new` is a static segment, so React Router ranks it above
 * `me/requests/:id`. Request notifications link to `/network/me/requests/:id`.
 *
 * The request buttons on profiles are `requestSlot` from RequestActions,
 * passed to `<Profile slot>` by Task 15's directory-routes and
 * discover-routes.
 */

import type { RouteObject } from "react-router";
import { RequestDetail } from "./RequestDetail";
import { RequestForm } from "./RequestForm";
import { Requests } from "./Requests";
import { Saved } from "./Saved";

export const menteeRoutes: RouteObject[] = [
  { path: "me/requests", element: <Requests /> },
  { path: "me/requests/new", element: <RequestForm /> },
  { path: "me/requests/:id", element: <RequestDetail /> },
  { path: "me/saved", element: <Saved /> },
];
