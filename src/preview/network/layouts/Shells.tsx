/**
 * Two shells: the public network pages share the site's header grammar;
 * signed-in areas get an application shell with a rail on desktop and a
 * labelled tab bar on phones. The prototype bar above both switches roles.
 */

import { useEffect, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bookmark,
  CalendarClock,
  ChevronDown,
  Compass,
  FlaskConical,
  Flag,
  Home,
  Inbox,
  LayoutGrid,
  LogOut,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { LogoLetters, LogoMark } from "../../../components/Logo";
import { Link, useRouter } from "../router";
import { useStore } from "../state/store";
import { fullName, initials } from "../data/mock";
import type { Role } from "../data/types";
import { Monogram, Toast } from "../../../network/ui/ui";

const ROLE_LABEL: Record<Role, string> = {
  visitor: "Visitor",
  mentee: "Student",
  mentor: "Mentor",
  admin: "Admin",
};

export const ROLE_HOME: Record<Role, string> = {
  visitor: "/",
  mentee: "/me",
  mentor: "/mentor",
  admin: "/admin",
};

/** The fixed strip above the prototype: perspective switcher and reset. */
export function PreviewBar() {
  const { state, dispatch } = useStore();
  const { navigate } = useRouter();
  const roles: Role[] = ["visitor", "mentee", "mentor", "admin"];

  const switchRole = (role: Role) => {
    dispatch({ type: "setRole", role });
    navigate(ROLE_HOME[role]);
  };

  return (
    <div className="pn-bar" role="region" aria-label="Prototype controls">
      <span className="pn-bar-note">
        <FlaskConical size={13} aria-hidden="true" />
        <span>Prototype · fictional data · nothing is sent or saved</span>
      </span>
      <div className="pn-bar-roles" role="group" aria-label="View as">
        <span className="mr-2">View as</span>
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            className="pn-bar-role"
            aria-pressed={state.role === r}
            onClick={() => switchRole(r)}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="pn-bar-select">
        <span className="sr-only">View as</span>
        <select value={state.role} onChange={(e) => switchRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <ChevronDown size={12} aria-hidden="true" />
      </label>
      <button
        type="button"
        className="pn-bar-reset"
        onClick={() => dispatch({ type: "reset" })}
        title="Restore the sample data"
      >
        <RotateCcw size={12} aria-hidden="true" />
        <span className="hidden md:inline">Reset data</span>
      </button>
    </div>
  );
}

export function ToastHost() {
  const { state } = useStore();
  return state.toast ? <Toast key={state.toast.id} text={state.toast.text} /> : null;
}

/* ---------- Public shell ---------- */

const PUBLIC_NAV = [
  { to: "/directory", label: "Directory" },
  { to: "/mentorship", label: "Mentorship" },
  { to: "/join", label: "Join the network" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const signedIn = state.role !== "visitor";
  return (
    <>
      <header className="pn-header">
        <div className="shell pn-header-inner">
          <div className="flex items-center gap-3">
            <Link to="/" className="wordmark" aria-label="MEST professional network, home">
              <LogoMark className="wordmark-mark" />
              <LogoLetters className="wordmark-letters" />
            </Link>
            <span className="pn-header-section">Network</span>
          </div>
          <nav aria-label="Network" className="nav-links">
            {PUBLIC_NAV.map((item) => (
              <Link key={item.to} to={item.to} prefix className="nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="pn-header-actions">
            {signedIn ? (
              <Link to={ROLE_HOME[state.role]} className="btn btn-outline">
                My dashboard
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link to="/signin" className="nav-link hidden md:inline-flex">
                  Sign in
                </Link>
                <Link to="/join" className="btn btn-outline">
                  Join
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="border-t border-[var(--pn-line)]">
        <div className="shell py-10 flex flex-wrap items-center justify-between gap-4 text-fg-2 t-small">
          <span>Muslim Engineers in Science &amp; Tech · Professional network</span>
          <nav aria-label="Footer" className="flex gap-6">
            {PUBLIC_NAV.map((item) => (
              <Link key={item.to} to={item.to} className="link link-quiet">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}

/* ---------- App shell ---------- */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  count?: number;
  prefix?: boolean;
}

/**
 * The app shell takes the perspective from the URL's area, so a deep link
 * into /mentor while viewing as a student switches the prototype to the
 * mentor perspective instead of mixing the two. Visitors get the gate.
 */
export function AppShell({ children, title, area }: { children: ReactNode; title?: string; area: Exclude<Role, "visitor"> }) {
  const { state, me, dispatch } = useStore();
  const { navigate } = useRouter();
  const role: Role = state.role === "visitor" ? "visitor" : area;

  useEffect(() => {
    if (state.role !== "visitor" && state.role !== area) dispatch({ type: "setRole", role: area });
  }, [state.role, area, dispatch]);

  const pendingForMentor = state.requests.filter((r) => r.mentorId === me.mentor.id && r.status === "pending").length;
  const approvals = state.professionals.filter((p) => p.approval === "pending").length;
  const openReports = state.reports.filter((r) => r.status === "open").length;
  const menteeActive = state.requests.filter(
    (r) => r.menteeId === me.mentee.id && (r.status === "pending" || r.status === "accepted"),
  ).length;

  const nav: Record<Exclude<Role, "visitor">, { groups: { label: string; items: NavItem[] }[]; tabs: NavItem[] }> = {
    mentee: {
      groups: [
        {
          label: "Mentorship",
          items: [
            { to: "/me", label: "Home", icon: Home },
            { to: "/me/discover", label: "Find mentors", icon: Compass, prefix: true },
            { to: "/me/requests", label: "My requests", icon: Inbox, count: menteeActive || undefined, prefix: true },
            { to: "/me/saved", label: "Saved", icon: Bookmark },
          ],
        },
        {
          label: "Network",
          items: [
            { to: "/directory", label: "Directory", icon: LayoutGrid, prefix: true },
            { to: "/me/settings", label: "Profile & privacy", icon: Settings },
          ],
        },
      ],
      tabs: [
        { to: "/me", label: "Home", icon: Home },
        { to: "/me/discover", label: "Mentors", icon: Compass, prefix: true },
        { to: "/me/requests", label: "Requests", icon: Inbox, count: menteeActive || undefined, prefix: true },
        { to: "/me/saved", label: "Saved", icon: Bookmark },
        { to: "/me/settings", label: "Profile", icon: UserRound },
      ],
    },
    mentor: {
      groups: [
        {
          label: "Mentoring",
          items: [
            { to: "/mentor", label: "Home", icon: Home },
            { to: "/mentor/requests", label: "Requests", icon: Inbox, count: pendingForMentor || undefined, prefix: true },
            { to: "/mentor/mentees", label: "Mentees", icon: Users, prefix: true },
            { to: "/mentor/availability", label: "Availability", icon: CalendarClock },
          ],
        },
        {
          label: "Account",
          items: [
            { to: "/mentor/profile", label: "Edit profile", icon: UserRound },
            { to: "/mentor/settings", label: "Privacy & notifications", icon: Settings },
            { to: "/directory", label: "Directory", icon: LayoutGrid, prefix: true },
          ],
        },
      ],
      tabs: [
        { to: "/mentor", label: "Home", icon: Home },
        { to: "/mentor/requests", label: "Requests", icon: Inbox, count: pendingForMentor || undefined, prefix: true },
        { to: "/mentor/mentees", label: "Mentees", icon: Users, prefix: true },
        { to: "/mentor/availability", label: "Availability", icon: CalendarClock },
        { to: "/mentor/profile", label: "Profile", icon: UserRound },
      ],
    },
    admin: {
      groups: [
        {
          label: "Administration",
          items: [
            { to: "/admin", label: "Overview", icon: Home },
            { to: "/admin/approvals", label: "Approval queue", icon: ShieldCheck, count: approvals || undefined, prefix: true },
            { to: "/admin/members", label: "Members", icon: Users, prefix: true },
            { to: "/admin/mentorship", label: "Mentorship activity", icon: CalendarClock },
            { to: "/admin/reports", label: "Reports", icon: Flag, count: openReports || undefined },
          ],
        },
        {
          label: "Network",
          items: [{ to: "/directory", label: "Public directory", icon: LayoutGrid, prefix: true }],
        },
      ],
      tabs: [
        { to: "/admin", label: "Overview", icon: Home },
        { to: "/admin/approvals", label: "Approvals", icon: ShieldCheck, count: approvals || undefined, prefix: true },
        { to: "/admin/members", label: "Members", icon: Users, prefix: true },
        { to: "/admin/mentorship", label: "Activity", icon: CalendarClock },
        { to: "/admin/reports", label: "Reports", icon: Flag, count: openReports || undefined },
      ],
    },
  };

  if (role === "visitor") {
    return <SignedOutGate />;
  }

  const current = nav[role];
  const person =
    role === "mentee"
      ? { name: fullName(me.mentee), initials: initials(me.mentee), role: "Student member", student: true }
      : role === "mentor"
        ? { name: fullName(me.mentor), initials: initials(me.mentor), role: "Mentor · Professional", student: false }
        : { name: "Board administrator", initials: "MA", role: "Administrator", student: false };

  const signOut = () => {
    dispatch({ type: "setRole", role: "visitor" });
    navigate("/");
  };

  return (
    <div className="pn-app">
      <aside className="pn-rail" aria-label="Dashboard">
        <div className="pn-rail-brand">
          <Link to="/" className="wordmark" aria-label="MEST network home">
            <LogoMark className="wordmark-mark" />
            <LogoLetters className="wordmark-letters" />
          </Link>
        </div>
        <div className="pn-rail-user">
          <Monogram initials={person.initials} size="sm" student={person.student} />
          <div className="min-w-0">
            <div className="pn-rail-user-name truncate">{person.name}</div>
            <div className="pn-rail-user-role">{person.role}</div>
          </div>
        </div>
        <nav aria-label="Sections">
          {current.groups.map((g) => (
            <div className="pn-rail-group" key={g.label}>
              <span className="pn-rail-group-label">{g.label}</span>
              {g.items.map((item) => (
                <Link key={item.to} to={item.to} prefix={item.prefix} className="pn-rail-link" title={item.label}>
                  <item.icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.count ? <span className="pn-rail-count">{item.count}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="pn-rail-foot">
          <button type="button" className="btn btn-ghost btn-sm justify-start" onClick={signOut}>
            <LogOut size={16} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="pn-main">
        <div className="pn-topbar md:hidden">
          <Link to="/" className="wordmark" aria-label="MEST network home">
            <LogoMark className="wordmark-mark" />
          </Link>
          <div className="flex items-center gap-3">
            <span className="t-small text-fg-2">{title ?? person.name}</span>
            <Monogram initials={person.initials} size="sm" student={person.student} />
          </div>
        </div>
        <div className="pn-main-inner">{children}</div>
      </div>

      <nav className="pn-tabbar" aria-label="Sections">
        {current.tabs.map((item) => (
          <Link key={item.to} to={item.to} prefix={item.prefix}>
            <item.icon size={20} aria-hidden="true" />
            {item.label}
            {item.count ? <span className="pn-rail-count">{item.count}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Shown when a signed-in area is opened from the visitor perspective. */
function SignedOutGate() {
  const { dispatch } = useStore();
  const { route, navigate } = useRouter();
  const area = route.segments[0];
  const target: Role = area === "admin" ? "admin" : area === "mentor" ? "mentor" : "mentee";
  const who = target === "admin" ? "a board administrator" : target === "mentor" ? "Layla Haddad, a mentor" : "Amina Rahman, a student";

  useEffect(() => {
    document.title = "Sign in · MEST network";
  }, []);

  return (
    <PublicShell>
      <div className="shell section">
        <div className="max-w-xl">
          <span className="pn-kicker">Signed-in area</span>
          <h1 className="t-display-md mt-4">This page needs an account.</h1>
          <p className="t-lead text-fg-2 mt-6">
            In the real platform you would sign in with a magic link or Google. For this prototype, continue as{" "}
            {who}.
          </p>
          <div className="flex flex-wrap gap-4 mt-8">
            <button
              type="button"
              className="btn btn-solid"
              onClick={() => {
                dispatch({ type: "setRole", role: target });
                navigate(route.path);
              }}
            >
              Continue as {target === "admin" ? "administrator" : target}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <Link to="/signin" className="btn btn-outline">
              See the sign-in screen
            </Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
