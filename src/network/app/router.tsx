/**
 * The network app's router: path routes under `/network` (the server answers
 * index.html for any `/network/*` path), a root that binds the shared UI's
 * links to React Router, and scroll restoration between pages.
 */

import { Link, Outlet, ScrollRestoration, createBrowserRouter } from "react-router";
import { UiLinkProvider, type UiLinkProps } from "../ui/ui";
import { routes } from "./routes";

export const NETWORK_BASENAME = "/network";

function RouterLink({ to, className, children }: UiLinkProps) {
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

function Root() {
  return (
    <UiLinkProvider value={RouterLink}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Outlet />
      <ScrollRestoration />
    </UiLinkProvider>
  );
}

export function createNetworkRouter() {
  return createBrowserRouter([{ element: <Root />, children: routes }], { basename: NETWORK_BASENAME });
}
