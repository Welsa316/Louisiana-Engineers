import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

/**
 * Isolated design prototype for the professional network. It is reached only
 * by its URL prefix, is never linked from the public site, and is split into
 * its own chunk so the landing page's bundle is unchanged.
 */
const PREVIEW_PREFIX = "/preview/professional-network";
const { pathname } = window.location;
const isPreview = pathname === PREVIEW_PREFIX || pathname.startsWith(`${PREVIEW_PREFIX}/`);
const NetworkPreview = lazy(() => import("./preview/network/NetworkPreview"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPreview ? (
      <Suspense fallback={null}>
        <NetworkPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
