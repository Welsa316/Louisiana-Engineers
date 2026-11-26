/**
 * The administration area, relative to `/network` (03 section 2.1). The
 * orchestrator spreads `adminRoutes` into `adminPages` in
 * src/network/app/routes.tsx in place of the `admin/*` stub; that list
 * already sits behind `RequireAdmin`, and every API call is checked again by
 * `requireAdmin` and the SQL functions. `reports` stays a stub until Task 24.
 */

import { Outlet, type RouteObject } from "react-router";
import { NotFoundPage } from "../../app/shells";
import { AdminNav, AuditLine, type AdminSection } from "../../ui/admin-controls";
import { Stub } from "../public/Stub";
import { Admins } from "./Admins";
import { Approvals } from "./Approvals";
import { Members } from "./Members";
import { Mentorship } from "./Mentorship";
import { Overview } from "./Overview";
import { Settings } from "./Settings";
import { Vocabulary } from "./Vocabulary";
import { useReviews, useTags } from "./api";

function AdminLayout() {
  const waiting = useReviews("pending", 1, 1).data?.total;
  const proposed = useTags("proposed", 1, 1).data?.total;
  const sections: AdminSection[] = [
    { to: "/admin", label: "Overview", end: true },
    { to: "/admin/queue", label: "Approval queue", count: waiting },
    { to: "/admin/members", label: "Members" },
    { to: "/admin/vocabulary", label: "Vocabulary", count: proposed },
    { to: "/admin/mentorship", label: "Mentorship" },
    { to: "/admin/reports", label: "Reports" },
    { to: "/admin/administrators", label: "Administrators" },
    { to: "/admin/settings", label: "Settings" },
  ];
  return (
    <div className="pn-admin">
      <AdminNav sections={sections} />
      <AuditLine />
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}

export const adminRoutes: RouteObject[] = [
  {
    path: "admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: "queue", element: <Approvals /> },
      { path: "queue/:reviewId", element: <Approvals /> },
      { path: "members", element: <Members /> },
      { path: "vocabulary", element: <Vocabulary /> },
      { path: "mentorship", element: <Mentorship /> },
      {
        path: "reports",
        element: (
          <Stub inApp kicker="Reports" title="Flagged profiles.">
            Reports from members arrive here once reporting opens.
          </Stub>
        ),
      },
      { path: "administrators", element: <Admins /> },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <NotFoundPage inApp /> },
    ],
  },
];
