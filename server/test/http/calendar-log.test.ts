import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newSecret } from "../../src/auth/session";
import { testApp } from "../harness";

/**
 * The calendar feed's address is its key, so an error log must not write
 * it: a forced failure behind `GET /api/calendar/:token.ics` logs the route
 * with the token redacted.
 */

vi.mock("../../src/services/calendar", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/services/calendar")>();
  return {
    ...original,
    calendarEvents: async () => {
      throw new Error("feed lookup failed");
    },
  };
});

const { calendarRoutes } = await import("../../src/routes/calendar");
const { redactPath } = await import("../../src/http/errors");
const app = testApp(new Hono().route("/calendar", calendarRoutes));

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")).join("\n");
}

describe("error logs on the calendar feed", () => {
  it("a_forced_500_on_the_feed_logs_the_route_without_the_token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = newSecret();
    const res = await app.request(`/api/calendar/${token}.ics`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal" });

    expect(spy).toHaveBeenCalledTimes(1);
    const text = logged(spy);
    expect(text).toContain("GET /api/calendar/<redacted>.ics failed");
    expect(text).not.toContain(token);
  });

  it("redact_path_keeps_every_other_path", () => {
    expect(redactPath("/api/calendar/abc123.ics")).toBe("/api/calendar/<redacted>.ics");
    expect(redactPath("/api/calendar/abc123")).toBe("/api/calendar/<redacted>");
    expect(redactPath("/api/me/calendar")).toBe("/api/me/calendar");
    expect(redactPath("/api/meetings/7d0c4c5e/cancel")).toBe("/api/meetings/7d0c4c5e/cancel");
  });
});
