import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const { pathname } = window.location;

/**
 * The MEST Network app lives under /network (the server answers index.html
 * for any /network/* path). It is split into its own chunk so the landing
 * page's bundle is unchanged.
 */
const isNetwork = pathname === "/network" || pathname.startsWith("/network/");
const NetworkApp = lazy(() => import("./network/main"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isNetwork ? (
      <Suspense fallback={null}>
        <NetworkApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
