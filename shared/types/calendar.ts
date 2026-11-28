/**
 * Shapes of the calendar feed endpoints (Task 37, migration 0019):
 *
 * - `GET    /api/me/calendar`          whether the caller's feed is on
 * - `POST   /api/me/calendar`          turn it on, or give it a new address (the old one stops working)
 * - `DELETE /api/me/calendar`          turn it off
 * - `GET    /api/calendar/:token.ics`  the feed itself, for a calendar app (no session; the address is the key)
 *
 * The address holds a 32-byte secret of which only the sha256 is stored, so
 * it is in the answer to `POST` once and never again.
 */

/** A working feed. */
export interface CalendarFeed {
  createdAt: string;
}

/** `GET` and `DELETE /api/me/calendar`: the feed, or null when it is off. */
export interface CalendarFeedResponse {
  feed: CalendarFeed | null;
}

/** `POST /api/me/calendar` (201): the new feed and its address, shown this once. */
export interface CreatedCalendarFeedResponse {
  feed: CalendarFeed;
  /** `https://<origin>/api/calendar/<token>.ics`. */
  url: string;
  /** The same address with the `webcal:` scheme, which calendar apps open as a subscription. */
  webcalUrl: string;
}

/** In the personal data export: that a feed is on and since when. The address is not in the file. */
export type ExportCalendarFeed = CalendarFeed;
