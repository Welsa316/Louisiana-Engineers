import type { CalendarFeed, ExportCalendarFeed } from "@shared/types/calendar";
import type { MeetingModeHeld, MeetingStatus } from "@shared/types/meetings";
import type { RequestRole } from "@shared/types/requests";
import { isSecretShaped, newSecret, sha256Hex } from "../auth/session";
import type { Db } from "../db/tx";

/**
 * The calendar feed (Task 37, migration 0019). A member's feed address
 * carries a 32-byte secret; `create_calendar_token` stores only its sha256
 * and revokes any earlier one. A calendar app reads the feed with no session,
 * so `calendarEvents` runs `calendar_feed(hash)` in an anonymous `withUser`
 * transaction and the SQL function decides everything: a working token, an
 * owner who may use the platform, and the owner's meetings only. This module
 * turns the result into iCalendar text (RFC 5545).
 */

/* -------------------------------------------------------------- settings */

/** The caller's working feed, read under the owner policy (which never exposes the hash). */
export async function ownCalendarFeed(db: Db): Promise<CalendarFeed | null> {
  const row = await db.maybeOne<{ created_at: Date }>(
    "SELECT created_at FROM calendar_tokens WHERE profile_id = app_uid() AND revoked_at IS NULL",
  );
  return row ? { createdAt: row.created_at.toISOString() } : null;
}

/** Turns the caller's feed on or renews it; the raw token, which is never stored. */
export async function createCalendarFeed(db: Db): Promise<{ token: string; feed: CalendarFeed }> {
  const token = newSecret();
  const { made } = await db.one<{ made: Date }>("SELECT create_calendar_token($1) AS made", [sha256Hex(token)]);
  return { token, feed: { createdAt: made.toISOString() } };
}

export async function revokeCalendarFeed(db: Db): Promise<void> {
  await db.query("SELECT revoke_calendar_token()");
}

/** For the personal data export: that a feed is on and since when. */
export function calendarFeedForExport(db: Db): Promise<ExportCalendarFeed | null> {
  return ownCalendarFeed(db);
}

/** `<origin>/api/calendar/<token>.ics` and its `webcal:` twin. */
export function feedUrls(origin: string, token: string): { url: string; webcalUrl: string } {
  const url = new URL(`/api/calendar/${token}.ics`, origin).toString();
  return { url, webcalUrl: url.replace(/^https?:/, "webcal:") };
}

/* ------------------------------------------------------------------ feed */

/** One meeting as the feed may show it: no place, no agenda, the other party's first name only. */
export interface CalendarEvent {
  id: string;
  requestId: string;
  /** The feed owner's side of the request, for the link back to it. */
  role: RequestRole;
  otherFirstName: string | null;
  /** The other party's account was deleted. */
  otherFormer: boolean;
  startsAt: Date;
  durationMin: number;
  mode: MeetingModeHeld;
  status: MeetingStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface FeedItem {
  id: string;
  requestId: string;
  role: RequestRole;
  otherFirstName: string | null;
  otherFormer: boolean;
  startsAt: string;
  durationMin: number;
  mode: MeetingModeHeld;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The events behind a feed token, or null when the token is malformed,
 * unknown or revoked, or its owner cannot use the platform. Run it in
 * `withUser(null, ...)`: the token is the only authority.
 */
export async function calendarEvents(db: Db, token: string): Promise<CalendarEvent[] | null> {
  if (!isSecretShaped(token)) return null;
  const { feed } = await db.one<{ feed: FeedItem[] | null }>("SELECT calendar_feed($1) AS feed", [sha256Hex(token)]);
  if (!feed) return null;
  return feed.map((item) => ({
    ...item,
    startsAt: new Date(item.startsAt),
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  }));
}

/* ------------------------------------------------------------- iCalendar */

/**
 * TEXT escaping (RFC 5545 section 3.3.11): backslash, semicolon and comma
 * get a backslash, every line break becomes `\n`, and the other control
 * characters, which TEXT does not allow, are dropped (a tab stays).
 */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const MAX_OCTETS = 75;

/**
 * Line folding (RFC 5545 section 3.1): a content line longer than 75 octets
 * is split with CRLF and one space, never inside a UTF-8 character. Each
 * continuation line carries the space, so it holds at most 74 more octets.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= MAX_OCTETS) return line;
  const pieces: string[] = [];
  let current = "";
  let size = 0;
  let limit = MAX_OCTETS;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (size + bytes > limit) {
      pieces.push(current);
      current = "";
      size = 0;
      limit = MAX_OCTETS - 1;
    }
    current += char;
    size += bytes;
  }
  pieces.push(current);
  return pieces.join("\r\n ");
}

/** A UTC date-time, `YYYYMMDDTHHMMSSZ`. */
function utc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** The other party as the summary names them. */
function otherName(event: CalendarEvent): string {
  if (event.otherFormer) return "Former member";
  return event.otherFirstName?.trim() || "Member";
}

/** The mentee's request page, or the mentor's mentorship page (where the meetings are). */
function requestPage(origin: string, event: CalendarEvent): string {
  const page = event.role === "mentee" ? "me/requests" : "mentor/mentees";
  return new URL(`/network/${page}/${event.requestId}`, origin).toString();
}

/**
 * The feed as an iCalendar object: one VEVENT per meeting, times in UTC,
 * CRLF line ends and folded lines. The summary is "MEST mentorship:" and the
 * other party's first name; the description says whether the meeting is
 * online or in person and points to the request page, where the place and
 * agenda stay behind the member's sign-in.
 */
export function renderCalendar(events: CalendarEvent[], options: { origin: string }): string {
  const host = new URL(options.origin).hostname;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MEST Network//Mentorship calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText("MEST mentorship")}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    const ends = new Date(event.startsAt.getTime() + event.durationMin * 60_000);
    const link = requestPage(options.origin, event);
    const how = event.mode === "in-person" ? "In-person meeting" : "Online meeting";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@${host}`,
      `DTSTAMP:${utc(event.updatedAt)}`,
      `CREATED:${utc(event.createdAt)}`,
      `LAST-MODIFIED:${utc(event.updatedAt)}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(ends)}`,
      `SUMMARY:${escapeText(`MEST mentorship: ${otherName(event)}`)}`,
      `DESCRIPTION:${escapeText(`${how}. The place and what you plan to talk about are on MEST Network: ${link}`)}`,
      `URL:${link}`,
      `STATUS:${event.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
