/**
 * Formatting for the dashboard measures (`admin_dashboard`, migration 0009),
 * shared by the overview and the mentorship activity screen. A measure with
 * nothing to count yet reads "None yet" rather than a misleading zero.
 */

import type { ReactNode } from "react";

/** The Stat value for a measure that can be null. */
export function measure(value: number | null | undefined, empty = "None yet"): ReactNode {
  if (value === undefined) return <span className="sr-only">Loading</span>;
  if (value === null) return <span className="pn-stat-empty">{empty}</span>;
  return value;
}

/** Hours under two days, days from there, one decimal at most. */
export function duration(hours: number | null | undefined): { value: ReactNode; unit?: string } {
  if (hours === null || hours === undefined) return { value: measure(hours) };
  if (hours < 48) return { value: trim(hours), unit: hours === 1 ? "hour" : "hours" };
  const days = Math.round((hours / 24) * 10) / 10;
  return { value: trim(days), unit: "days" };
}

/** 7.0 reads 7; 7.5 stays 7.5. */
export function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "2026-11" as "Nov 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, m - 1, 1)),
  );
}
