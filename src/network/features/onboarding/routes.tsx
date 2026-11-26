/**
 * Onboarding routes, relative to `/network`. The orchestrator spreads these
 * into `onboardingPages` in src/network/app/routes.tsx in place of the
 * onboarding stub (signed in, public shell, onboarding not required).
 */

import type { RouteObject } from "react-router";
import { Onboarding } from "./Onboarding";

export const onboardingRoutes: RouteObject[] = [{ path: "onboarding/*", element: <Onboarding /> }];
