import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const { pathname } = window.location;
const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The MEST Network app lives under /network (the server answers index.html
 * for any /network/* path). It is split into its own chunk so the landing
 * page's bundle is unchanged.
 */
const isNetwork = under("/network");
const NetworkApp = lazy(() => import("./network/main"));

/**
 * Isolated design prototype for the professional network. It is reached only
 * by its URL prefix, is never linked from the public site, and is split into
 * its own chunk so the landing page's bundle is unchanged.
 */
const isPreview = under("/preview/professional-network");
const NetworkPreview = lazy(() => import("./preview/network/NetworkPreview"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isNetwork ? (
      <Suspense fallback={null}>
        <NetworkApp />
      </Suspense>
    ) : isPreview ? (
      <Suspense fallback={null}>
        <NetworkPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
