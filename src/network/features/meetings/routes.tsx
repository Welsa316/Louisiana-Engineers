/**
 * The meetings log, relative to `/network` (Task 31). It is spread into
 * `meRoutes` (features/me/routes.tsx), which the app's route list already
 * mounts behind `RequireMember` and `RequireOnboarded`, so it needs no
 * change to the aggregator; the rail's "Meetings" item is the
 * orchestrator's to add in src/network/app/nav.ts.
 *
 *   me/meetings   upcoming and past meetings, both roles (`?show=past`)
 *
 * The scheduling itself lives on the relationship pages: `MeetingsPanel`
 * from ./Scheduling on mentor/mentees/:id and me/requests/:id.
 */

import type { RouteObject } from "react-router";
import { MeetingsLog } from "./MeetingsLog";

export const meetingRoutes: RouteObject[] = [{ path: "me/meetings", element: <MeetingsLog /> }];
