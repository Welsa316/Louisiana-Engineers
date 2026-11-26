/**
 * The two shells of the MEST Network. Public pages share the site's header
 * grammar, with a Menu sheet on phones. Signed-in pages get the application
 * shell: a rail on desktop (icons only at tablet widths) and a labelled tab
 * bar with a Menu sheet on phones (03 sections 3.2 and 12).
 *
 * Both take a `headerSlot` for controls other features mount without editing
 * this file (the notification bell, Task 18).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ArrowUpRight, LogOut, Menu as MenuIcon, UserRound } from "lucide-react";
import type { SessionUser } from "@shared/types/auth";
import { LogoLetters, LogoMark } from "../../components/Logo";
import { useMeta } from "../lib/meta";
import { useSession, useSignOut } from "../lib/session";
import { Empty, Sheet } from "../ui/ui";
import { navFor, type NavBadges, type NavItem } from "./nav";

/* ---------- Shared pieces ---------- */

/**
 * After a client-side navigation, move focus to the new page's `main` (it
 * has tabIndex -1), so keyboard and screen-reader users start at the new
 * content instead of on the link they used. The first load is left alone,
 * so the skip link stays the first Tab stop.
 */
function useFocusMainOnNavigate(): void {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);
}

function SignOutButton({ className, onDone }: { className: string; onDone?: () => void }) {
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
          onDone?.();
          navigate("/");
        } catch {
          // The server session is still valid, so stay signed in and say so.
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <LogOut size={16} aria-hidden="true" />
      <span>Sign out</span>
    </button>
    {failed ? (
      <p role="alert" className="t-small text-fg-2">
        Sign-out did not go through. Check your connection and try again.
      </p>
    ) : null}
    </>
  );
}

/** Where "my account" leads: onboarding until it is finished, then Home. */
function accountPath(user: SessionUser): string {
  if (user.hasDeletionScheduled) return "/scheduled-for-deletion";
  return user.kind === null ? "/onboarding" : "/me";
}

/* ---------- Public shell ---------- */

const PUBLIC_NAV = [
  { to: "/directory", label: "Directory" },
  { to: "/mentorship", label: "Mentorship" },
  { to: "/join", label: "Join the network" },
];

const FOOTER_NAV = [
  { to: "/directory", label: "Directory" },
  { to: "/mentorship", label: "Mentorship" },
  { to: "/guidelines", label: "Community guidelines" },
  { to: "/privacy", label: "Privacy" },
];

export function PublicShell({ children, headerSlot }: { children: ReactNode; headerSlot?: ReactNode }) {
  const { user, status } = useSession();
  useFocusMainOnNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  // "Join the network" means nothing to someone already signed in.
  const publicNav = user ? PUBLIC_NAV.filter((item) => item.to !== "/join") : PUBLIC_NAV;
  // No "Finish signing up" button on the onboarding page itself: it would
  // point at the current page (and it crowds the phone header there).
  const { pathname } = useLocation();
  const onAccountPage = user ? pathname === accountPath(user) || pathname.startsWith(`${accountPath(user)}/`) : false;

  return (
    <>
      <header className="pn-header">
        <div className="shell pn-header-inner">
          <div className="flex items-center gap-3">
            <a href="/" className="wordmark" aria-label="MEST, Muslim Engineers in Science & Tech. Main site">
              <LogoMark className="wordmark-mark" />
              <LogoLetters className="wordmark-letters" />
            </a>
            <Link to="/" className="pn-header-section">
              Network
            </Link>
          </div>
          <nav aria-label="Network" className="nav-links">
            {publicNav.map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-link">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="pn-header-actions">
            {headerSlot}
            {status === "loading" || onAccountPage ? null : user ? (
              <Link to={accountPath(user)} className="btn btn-outline pn-header-account">
                {user.kind === null ? "Finish signing up" : "My dashboard"}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            ) : (
              <>
                <NavLink to="/signin" className="nav-link hidden md:inline-flex">
                  Sign in
                </NavLink>
                <Link to="/join" className="btn btn-outline">
                  Join
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </>
            )}
            <button
              type="button"
              className="pn-icon-btn pn-header-menu"
              aria-label="Menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <MenuIcon size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <Sheet open={menuOpen} onClose={closeMenu} title="Menu">
        <nav aria-label="Network menu" className="pn-menu-list">
          {/* On phones the header has room for the logo and the menu only, so the account link lives here. */}
          {user && !onAccountPage ? (
            <Link to={accountPath(user)} className="pn-menu-link" onClick={closeMenu}>
              {user.kind === null ? "Finish signing up" : "My dashboard"}
            </Link>
          ) : null}
          {publicNav.map((item) => (
            <NavLink key={item.to} to={item.to} className="pn-menu-link" onClick={closeMenu}>
              {item.label}
            </NavLink>
          ))}
          {!user && (
            <NavLink to="/signin" className="pn-menu-link" onClick={closeMenu}>
              Sign in
            </NavLink>
          )}
          <a href="/" className="pn-menu-link">
            MEST main site
          </a>
        </nav>
      </Sheet>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="border-t border-[var(--pn-line)]">
        <div className="shell py-10 flex flex-wrap items-center justify-between gap-4 text-fg-2 t-small">
          <span>Muslim Engineers in Science &amp; Tech · MEST Network</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_NAV.map((item) => (
              <Link key={item.to} to={item.to} className="link link-quiet">
                {item.label}
              </Link>
            ))}
            <a href="/" className="link link-quiet">
              Main site
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}

/* ---------- App shell ---------- */

function kindLabel(user: SessionUser): string {
  if (user.kind === "student") return "Student";
  if (user.kind === "professional") return "Professional";
  return "Member";
}

function statusLine(user: SessionUser): string {
  if (user.isAdmin) return "Administrator";
  if (user.kind !== "professional") return "Signed in";
  if (user.approvalState === "pending") return "Waiting for review";
  if (user.approvalState === "declined") return "Not approved";
  return "Approved";
}

function RailLink({ item, count }: { item: NavItem; count?: number }) {
  return (
    <NavLink to={item.to} end={item.end} className="pn-rail-link" title={item.label}>
      <item.icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
      {count ? (
        <span className="pn-rail-count">
          {count}
          <span className="sr-only"> new</span>
        </span>
      ) : null}
    </NavLink>
  );
}

export function AppShell({
  children,
  headerSlot,
  badges = {},
}: {
  children: ReactNode;
  headerSlot?: ReactNode;
  badges?: NavBadges;
}) {
  const { user } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  useFocusMainOnNavigate();
  // Guards render the shell only for a signed-in member; this keeps the
  // types honest if it is ever mounted elsewhere.
  if (!user) return null;
  const nav = navFor(user);

  return (
    <div className="pn-app">
      <aside className="pn-rail" aria-label="Network">
        <div className="pn-rail-brand">
          <Link to="/" className="wordmark" aria-label="MEST Network home">
            <LogoMark className="wordmark-mark" />
            <LogoLetters className="wordmark-letters" />
          </Link>
        </div>
        <div className="pn-rail-user">
          <span className="pn-rail-user-icon" aria-hidden="true">
            <UserRound size={18} />
          </span>
          <div className="min-w-0">
            <div className="pn-rail-user-name truncate">{kindLabel(user)}</div>
            <div className="pn-rail-user-role">{statusLine(user)}</div>
          </div>
        </div>
        <nav aria-label="Sections">
          {nav.groups.map((group) => (
            <div className="pn-rail-group" key={group.label}>
              <span className="pn-rail-group-label">{group.label}</span>
              {group.items.map((item) => (
                <RailLink key={item.id} item={item} count={badges[item.id]} />
              ))}
            </div>
          ))}
        </nav>
        <div className="pn-rail-foot">
          <SignOutButton className="btn btn-ghost btn-sm justify-start" />
        </div>
      </aside>

      <main id="main" className="pn-main" tabIndex={-1}>
        {/* One header row at every width, so the slot (the notification bell)
            mounts once: the logo and label are phone-only, and with no slot
            the row is phone-only too. */}
        <div className={headerSlot ? "pn-main-head" : "pn-main-head md:hidden"} data-testid="app-head">
          <Link to="/" className="wordmark md:hidden" aria-label="MEST Network home">
            <LogoMark className="wordmark-mark" />
          </Link>
          <div className="flex items-center gap-3">
            <span className="t-small text-fg-2 md:hidden">{kindLabel(user)}</span>
            {headerSlot}
          </div>
        </div>
        <div className="pn-main-inner">{children}</div>
      </main>

      <nav className="pn-tabbar" aria-label="Sections, tab bar">
        {nav.tabs.map((item) => (
          <NavLink key={item.id} to={item.to} end={item.end}>
            <item.icon size={20} aria-hidden="true" />
            {item.tabLabel ?? item.label}
            {badges[item.id] ? (
              <span className="pn-rail-count">
                {badges[item.id]}
                <span className="sr-only"> new</span>
              </span>
            ) : null}
          </NavLink>
        ))}
        <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <MenuIcon size={20} aria-hidden="true" />
          Menu
        </button>
      </nav>

      <Sheet open={menuOpen} onClose={closeMenu} title="Menu">
        <nav aria-label="More sections" className="pn-menu-list">
          {nav.menu.map((item) => (
            <NavLink key={item.id} to={item.to} end={item.end} className="pn-menu-link" onClick={closeMenu}>
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {badges[item.id] ? <span className="pn-rail-count">{badges[item.id]}</span> : null}
            </NavLink>
          ))}
          <SignOutButton className="pn-menu-link" onDone={closeMenu} />
        </nav>
      </Sheet>
    </div>
  );
}

/* ---------- Layout routes ---------- */

export function PublicLayout({ headerSlot }: { headerSlot?: ReactNode }) {
  return (
    <PublicShell headerSlot={headerSlot}>
      <Outlet />
    </PublicShell>
  );
}

export function AppLayout({ headerSlot, badges }: { headerSlot?: ReactNode; badges?: NavBadges }) {
  return (
    <AppShell headerSlot={headerSlot} badges={badges}>
      <Outlet />
    </AppShell>
  );
}

/* ---------- Not found ---------- */

/** The client-side 404 for unknown `/network/*` paths. `inApp` drops the public page gutters. */
export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  useMeta({ title: "Page not found" });
  return (
    <div className={inApp ? undefined : "shell section"}>
      <h1 className="t-display-md">Page not found</h1>
      <Empty
        title="There is nothing at this address."
        action={
          <Link to="/" className="btn btn-outline btn-sm">
            Network home
          </Link>
        }
      >
        The link may be out of date, or the page may have moved.
      </Empty>
    </div>
  );
}
