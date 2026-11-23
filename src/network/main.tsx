/**
 * Entry of the MEST Network app, loaded lazily by src/main.tsx for `/network`
 * and `/network/*` so the landing page's bundle never carries it.
 */

import { RouterProvider } from "react-router";
import { createNetworkRouter } from "./app/router";
import { QueryProvider } from "./lib/query";
import "./ui/network.css";

// One router per page load; this module is only ever imported under /network.
const router = createNetworkRouter();

export default function NetworkApp() {
  return (
    <QueryProvider>
      <div className="pn-root">
        <RouterProvider router={router} />
      </div>
    </QueryProvider>
  );
}
