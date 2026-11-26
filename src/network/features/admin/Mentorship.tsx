/**
 * Mentorship activity (03 section 8.4). Until requests exist (Task 19) and
 * their measures join `admin_dashboard` (Task 25), this shows the mentor
 * count the dashboard already has and says what will follow.
 */

import { useMeta } from "../../lib/meta";
import { Notice, PageHead, Stat } from "../../ui/ui";
import { adminErrorText, useAdminDashboard } from "./api";

export function Mentorship() {
  useMeta({ title: "Mentorship activity" });
  const dashboard = useAdminDashboard();

  return (
    <>
      <PageHead
        kicker="Mentorship activity"
        title="Is the program working?"
        lead="Aggregates for the board report. The content of requests is never shown here."
      />
      {dashboard.isError ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{adminErrorText(dashboard.error)}</Notice>
        </div>
      ) : (
        <div className="pn-stats mt-8">
          <Stat
            label="Active mentors"
            value={dashboard.data?.activeMentors ?? <span className="sr-only">Loading</span>}
            note="Listed professionals taking requests"
          />
        </div>
      )}
      <div className="mt-8 max-w-2xl">
        <Notice tone="info">
          Request measures appear here once mentorship requests open: requests sent, answered within 7 days, accepted,
          expired, and each mentor's load against their limit.
        </Notice>
      </div>
    </>
  );
}
