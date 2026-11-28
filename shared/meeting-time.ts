/**
 * Meeting times in Louisiana time (America/Chicago), whatever zone the
 * browser or the process runs in. The API stores and sends instants (UTC
 * ISO strings); the scheduling screens read and write the wall time the
 * pair means, and the copy names it the same way on every device.
 *
 * Built on `Intl.DateTimeFormat` with fixed numeric parts, so the output
 * does not depend on the runtime's locale data (some versions put a narrow
 * no-break space before "AM").
 */

export const LOUISIANA_TIME_ZONE = "America/Chicago";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: LOUISIANA_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallOf(instant: Date): Wall {
  const out: Record<string, number> = {};
  for (const part of parts.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Some runtimes write midnight as 24 even with h23.
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Louisiana's offset from UTC at the instant, in minutes (-360 in winter, -300 in summer). */
function offsetMinutes(instantMs: number): number {
  const w = wallOf(new Date(instantMs));
  const wallMs = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((wallMs - Math.floor(instantMs / 1000) * 1000) / MINUTE_MS);
}

/** The Louisiana date and time of an instant: `{ date: "YYYY-MM-DD", time: "HH:MM" }`. */
export function isoToLouisiana(iso: string): { date: string; time: string } {
  const w = wallOf(new Date(iso));
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

/**
 * The instant a Louisiana date (`YYYY-MM-DD`) and time (`HH:MM`, 24-hour)
 * name, as an ISO string, or null when either is malformed, the date does
 * not exist, or the time falls in the hour the spring clock change skips.
 * An autumn time that happens twice means the first of the two.
 */
export function louisianaToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (hour > 23 || minute > 59) return null;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  // The offset a day either side covers both sides of any clock change.
  const offsets = [...new Set([offsetMinutes(wallMs - DAY_MS), offsetMinutes(wallMs + DAY_MS)])];
  const matches = offsets
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((instant) => {
      const back = isoToLouisiana(new Date(instant).toISOString());
      return back.date === date && back.time === time;
    })
    .sort((a, b) => a - b);
  return matches.length > 0 ? new Date(matches[0]).toISOString() : null;
}

/** The Louisiana date `days` after the instant's own Louisiana date, as `YYYY-MM-DD`. */
export function louisianaDateAfter(instant: Date, days: number): string {
  const w = wallOf(instant);
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** "Thu, Dec 3" (or "Thu, Dec 3, 2026"), the Louisiana day of the instant. */
export function fmtMeetingDay(iso: string, withYear = false): string {
  const w = wallOf(new Date(iso));
  const weekday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  return `${DAYS[weekday]}, ${MONTHS[w.month - 1]} ${w.day}${withYear ? `, ${w.year}` : ""}`;
}

function clock(w: Wall): { text: string; period: "AM" | "PM" } {
  const hour = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return { text: `${hour}:${pad(w.minute)}`, period: w.hour < 12 ? "AM" : "PM" };
}

/** "10:30 AM", the Louisiana time of the instant. */
export function fmtMeetingTime(iso: string): string {
  const c = clock(wallOf(new Date(iso)));
  return `${c.text} ${c.period}`;
}

/** "Thu, Dec 3 · 10:30 to 11:15 AM": the day, and the times with one period when both share it. */
export function fmtMeetingSpan(startIso: string, endIso: string): string {
  const start = clock(wallOf(new Date(startIso)));
  const end = clock(wallOf(new Date(endIso)));
  const times =
    start.period === end.period
      ? `${start.text} to ${end.text} ${end.period}`
      : `${start.text} ${start.period} to ${end.text} ${end.period}`;
  return `${fmtMeetingDay(startIso)} · ${times}`;
}

/** "45 minutes", "1 hour", "1 hour 30 minutes". */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : h === 1 ? "1 hour" : `${h} hours`;
  const mins = m === 0 ? "" : `${m} minutes`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}
