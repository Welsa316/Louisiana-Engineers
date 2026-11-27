/**
 * Controls the administration area adds (03 section 8): the section links
 * across the top of every admin page, the standing audit-log reminder, and
 * the pager for long lists. They reuse the `pn-tab` and button styles; the
 * few rules they add live in admin.css.
 */

import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { NavLink } from "react-router";
import "./admin.css";

export interface AdminSection {
  to: string;
  label: string;
  /** Current only on an exact match (the overview). */
  end?: boolean;
  count?: number;
}

/** Links between the admin pages, styled like the filter tabs but marked with `aria-current`. */
export function AdminNav({ sections }: { sections: AdminSection[] }) {
  return (
    <nav className="pn-tabs pn-admin-nav" aria-label="Administration sections">
      {sections.map((s) => (
        <NavLink key={s.to} to={s.to} end={s.end} className="pn-tab">
          {s.label}
          {typeof s.count === "number" && s.count > 0 ? (
            <span className="pn-tab-count">
              {s.count}
              <span className="sr-only"> waiting</span>
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

/** The line every admin page carries (03 section 3.4). */
export function AuditLine() {
  return (
    <p className="pn-admin-audit t-small">
      <ScrollText size={14} aria-hidden="true" />
      Actions here are recorded in the audit log.
    </p>
  );
}

/** Previous and next page for a `{ items, total }` list. Renders nothing for a single page. */
export function Pager({
  page,
  size,
  total,
  onPage,
  label,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav className="pn-admin-pager" aria-label={label}>
      <button type="button" className="btn btn-outline btn-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} aria-hidden="true" />
        Previous
      </button>
      <span className="t-small text-fg-2" aria-live="polite">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn btn-outline btn-xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}
