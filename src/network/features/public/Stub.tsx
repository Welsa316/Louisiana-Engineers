/**
 * Placeholder page for a route whose screen has not landed yet. Each feature
 * task replaces its stubs by exporting real routes from its own
 * `features/<area>/routes.tsx`; the orchestrator swaps them in routes.tsx.
 */

import type { ReactNode } from "react";
import { useMeta } from "../../lib/meta";
import { Notice, PageHead } from "../../ui/ui";

export function Stub({
  title,
  kicker,
  lead,
  inApp = false,
  children,
}: {
  title: string;
  kicker?: string;
  lead?: ReactNode;
  /** Inside the app shell, which already pads its content. */
  inApp?: boolean;
  children?: ReactNode;
}) {
  useMeta({ title });
  return (
    <div className={inApp ? undefined : "shell section"}>
      <PageHead kicker={kicker} title={title} lead={lead} />
      <div className="mt-8 max-w-2xl">
        <Notice tone="info">{children ?? "This page is being built. Check back soon."}</Notice>
      </div>
    </div>
  );
}
