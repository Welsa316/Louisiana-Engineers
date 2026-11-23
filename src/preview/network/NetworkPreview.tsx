/**
 * Root of the isolated professional-network prototype, mounted only at
 * /preview/professional-network/ (see src/main.tsx). Routes are matched by
 * hand against the hash path; the real build should use a router library.
 */

import { useEffect } from "react";
import "../../network/ui/network.css";
import { RouterProvider, useRouter } from "./router";
import { StoreProvider, useStore } from "./state/store";
import { AppShell, PreviewBar, PublicShell, ToastHost } from "./layouts/Shells";
import { Landing, MentorshipInfo } from "./screens/public/Landing";
import { Directory } from "./screens/public/Directory";
import { Profile } from "./screens/public/Profile";
import { Join, SignIn } from "./screens/public/Auth";
import { ProfessionalOnboarding, StudentOnboarding } from "./screens/onboarding/Onboarding";
import { MenteeDashboard, MenteeRequestDetail, MenteeRequests, MenteeSaved, MenteeSettings, RequestForm } from "./screens/mentee/Mentee";
import { MentorAvailability, MentorDashboard, MentorEditProfile, MentorMentees, MentorRequests, MentorSettings } from "./screens/mentor/Mentor";
import { AdminApprovals, AdminMembers, AdminMentorship, AdminOverview, AdminReports } from "./screens/admin/Admin";
import { Empty, UiLinkProvider } from "../../network/ui/ui";
import { Link } from "./router";

export default function NetworkPreview() {
  return (
    <StoreProvider>
      <RouterProvider>
        <UiLinkProvider value={Link}>
          <div className="pn-root pn-preview">
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <PreviewBar />
            <Routes />
            <ToastHost />
          </div>
        </UiLinkProvider>
      </RouterProvider>
    </StoreProvider>
  );
}

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · MEST network (prototype)`;
  }, [title]);
}

function Routes() {
  const { route } = useRouter();
  const { state } = useStore();
  const [a, b, c] = route.segments;

  // ---------- Public ----------
  if (!a) return <Public title="Professional network"><Landing /></Public>;
  if (a === "mentorship") return <Public title="Mentorship"><MentorshipInfo /></Public>;
  if (a === "directory" && !b) return <Public title="Directory"><Directory /></Public>;
  if (a === "directory" && b) return <Public title="Profile"><Profile id={b} back={{ to: "/directory", label: "Directory" }} /></Public>;
  if (a === "signin") return <Public title="Sign in"><SignIn /></Public>;
  if (a === "join" && !b) return <Public title="Join"><Join /></Public>;
  if (a === "join" && b === "student") return <Public title="Student onboarding"><StudentOnboarding /></Public>;
  if (a === "join" && b === "professional") return <Public title="Professional onboarding"><ProfessionalOnboarding /></Public>;

  // ---------- Mentee ----------
  if (a === "me") {
    if (!b) return <App area="mentee" title="Home"><MenteeDashboard /></App>;
    if (b === "discover") return <App area="mentee" title="Find mentors"><Directory mode="mentors" /></App>;
    if (b === "mentors" && c) return <App area="mentee" title="Mentor"><Profile id={c} back={{ to: "/me/discover", label: "Find mentors" }} /></App>;
    if (b === "request" && c) return <App area="mentee" title="Request mentorship"><RequestForm mentorId={c} /></App>;
    if (b === "requests" && !c) return <App area="mentee" title="My requests"><MenteeRequests /></App>;
    if (b === "requests" && c) return <App area="mentee" title="Request"><MenteeRequestDetail id={c} /></App>;
    if (b === "saved") return <App area="mentee" title="Saved"><MenteeSaved /></App>;
    if (b === "settings") return <App area="mentee" title="Profile & privacy"><MenteeSettings /></App>;
  }

  // ---------- Mentor ----------
  if (a === "mentor") {
    if (!b) return <App area="mentor" title="Home"><MentorDashboard /></App>;
    if (b === "requests") return <App area="mentor" title="Requests"><MentorRequests selectedId={c} /></App>;
    if (b === "mentees") return <App area="mentor" title="Mentees"><MentorMentees selectedId={c} /></App>;
    if (b === "availability") return <App area="mentor" title="Availability"><MentorAvailability /></App>;
    if (b === "profile") return <App area="mentor" title="Edit profile"><MentorEditProfile /></App>;
    if (b === "settings") return <App area="mentor" title="Privacy & notifications"><MentorSettings /></App>;
  }

  // ---------- Admin ----------
  if (a === "admin") {
    if (!b) return <App area="admin" title="Overview"><AdminOverview /></App>;
    if (b === "approvals") return <App area="admin" title="Approval queue"><AdminApprovals selectedId={c} /></App>;
    if (b === "members") return <App area="admin" title="Members"><AdminMembers /></App>;
    if (b === "mentorship") return <App area="admin" title="Mentorship activity"><AdminMentorship /></App>;
    if (b === "reports") return <App area="admin" title="Reports"><AdminReports /></App>;
  }

  void state;
  return (
    <Public title="Not found">
      <div className="shell section">
        <Empty title="No such page in the prototype." action={<Link to="/" className="btn btn-outline btn-sm">Network home</Link>}>
          The path {route.path} is not part of this preview.
        </Empty>
      </div>
    </Public>
  );
}

function Public({ title, children }: { title: string; children: React.ReactNode }) {
  useTitle(title);
  return <PublicShell>{children}</PublicShell>;
}

function App({ title, children, area }: { title: string; children: React.ReactNode; area: "mentee" | "mentor" | "admin" }) {
  useTitle(title);
  return (
    <AppShell title={title} area={area}>
      {children}
    </AppShell>
  );
}
