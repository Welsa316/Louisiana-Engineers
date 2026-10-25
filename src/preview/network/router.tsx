/**
 * A deliberately small hash router for the isolated prototype. Routes live
 * after the `#`, so the production page's path handling is never touched
 * and deep links work on any static host:
 *
 *   /preview/professional-network/#/directory
 *   /preview/professional-network/#/directory/layla-haddad
 *
 * The real build should replace this with React Router or TanStack Router;
 * see docs/professional-network/02-technical-architecture.md.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

export interface Route {
  /** Path after the hash, always starting with "/". */
  path: string;
  /** Path segments, without the leading empty one. */
  segments: string[];
  query: URLSearchParams;
}

interface RouterValue {
  route: Route;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart = ""] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return {
    path: normalized,
    segments: normalized.split("/").filter(Boolean),
    query: new URLSearchParams(queryPart),
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse());

  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Scroll to top on navigation, except for same-path query changes.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [route.path]);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = `#${to.startsWith("/") ? to : `/${to}`}`;
    if (options?.replace) {
      const url = new URL(window.location.href);
      url.hash = target;
      window.history.replaceState(null, "", url);
      setRoute(parse());
    } else {
      window.location.hash = target;
    }
  }, []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside RouterProvider");
  return ctx;
}

/** True when the current path equals `path`, or starts with it when `prefix`. */
export function useIsActive(path: string, prefix = false): boolean {
  const { route } = useRouter();
  return prefix ? route.path === path || route.path.startsWith(`${path}/`) : route.path === path;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "prefix"> & {
  to: string;
  /** Marks the link current when the route is inside `to`. */
  prefix?: boolean;
  activeClassName?: string;
};

export function Link({ to, prefix, activeClassName, className, onClick, children, ...rest }: LinkProps) {
  const { route, navigate } = useRouter();
  const active = prefix ? route.path === to || route.path.startsWith(`${to}/`) : route.path === to;
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  const classes = [className, active && activeClassName].filter(Boolean).join(" ") || undefined;
  return (
    <a href={`#${to}`} className={classes} aria-current={active ? "page" : undefined} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
