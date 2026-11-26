/**
 * The settings area, relative to `/network` (03 section 2.1). The
 * orchestrator spreads `settingsRoutes` into `memberPages` in
 * src/network/app/routes.tsx in place of the `settings/*` stub; that list
 * already sits behind `RequireMember` and `RequireOnboarded`. `account`
 * stays a stub until Task 26 (export and deletion) replaces it.
 */

import type { RouteObject } from "react-router";
import { NotFoundPage } from "../../app/shells";
import { Stub } from "../public/Stub";
import { SettingsLayout } from "./Layout";
import { MentorshipSettings } from "./MentorshipSettings";
import { NotificationSettings } from "./NotificationSettings";
import { Preview } from "./Preview";
import { PrivacySettings } from "./PrivacySettings";
import { ProfileSettings } from "./ProfileSettings";

export const settingsRoutes: RouteObject[] = [
  {
    path: "settings",
    element: <SettingsLayout />,
    children: [
      // A phone shows the list of sections here; a wider screen, the profile.
      { index: true, element: <ProfileSettings metaTitle="Profile and settings" /> },
      { path: "profile", element: <ProfileSettings /> },
      { path: "privacy", element: <PrivacySettings /> },
      { path: "mentorship", element: <MentorshipSettings /> },
      { path: "notifications", element: <NotificationSettings /> },
      { path: "preview", element: <Preview /> },
      {
        path: "account",
        element: (
          <Stub inApp kicker="Account" title="Your account.">
            Exporting your data and deleting your account arrive here soon.
          </Stub>
        ),
      },
      { path: "*", element: <NotFoundPage inApp /> },
    ],
  },
];
