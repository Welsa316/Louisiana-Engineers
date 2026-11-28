import { describe, expect, it } from "vitest";
import {
  fmtDuration,
  fmtMeetingDay,
  fmtMeetingSpan,
  fmtMeetingTime,
  isoToLouisiana,
  louisianaDateAfter,
  louisianaToIso,
} from "./meeting-time";

/**
 * The scheduling screens read and write times in Louisiana (America/Chicago)
 * whatever the browser's own zone is, so a mentor travelling in another
 * state still proposes the times the pair means.
 */
describe("Louisiana wall time", () => {
  it("converts winter and summer times with their own offsets", () => {
    // Central Standard Time, UTC-6.
    expect(louisianaToIso("2026-12-03", "10:30")).toBe("2026-12-03T16:30:00.000Z");
    // Central Daylight Time, UTC-5.
    expect(louisianaToIso("2026-07-14", "17:45")).toBe("2026-07-14T22:45:00.000Z");
  });

  it("refuses a time the spring change skips and takes the first of a repeated autumn hour", () => {
    // 2026-03-08: clocks go from 2:00 to 3:00, so 2:30 never happens.
    expect(louisianaToIso("2026-03-08", "02:30")).toBeNull();
    expect(louisianaToIso("2026-03-08", "03:00")).toBe("2026-03-08T08:00:00.000Z");
    // 2026-11-01: 1:30 happens twice; the first (still daylight time) is meant.
    expect(louisianaToIso("2026-11-01", "01:30")).toBe("2026-11-01T06:30:00.000Z");
  });

  it("refuses malformed or impossible dates and times", () => {
    expect(louisianaToIso("2026-02-30", "10:00")).toBeNull();
    expect(louisianaToIso("2026-13-01", "10:00")).toBeNull();
    expect(louisianaToIso("", "10:00")).toBeNull();
    expect(louisianaToIso("2026-12-03", "")).toBeNull();
    expect(louisianaToIso("2026-12-03", "24:00")).toBeNull();
    expect(louisianaToIso("2026-12-03", "9:5")).toBeNull();
  });

  it("reads an instant back as the Louisiana date and time", () => {
    expect(isoToLouisiana("2026-12-03T16:30:00.000Z")).toEqual({ date: "2026-12-03", time: "10:30" });
    // Just after midnight UTC is still the evening before in Louisiana.
    expect(isoToLouisiana("2026-07-15T02:15:00.000Z")).toEqual({ date: "2026-07-14", time: "21:15" });
    expect(isoToLouisiana(louisianaToIso("2026-11-01", "01:30")!)).toEqual({ date: "2026-11-01", time: "01:30" });
  });

  it("counts days ahead on the Louisiana calendar", () => {
    // 03:00 UTC on Dec 4 is 21:00 on Dec 3 in Louisiana: tomorrow there is Dec 4.
    expect(louisianaDateAfter(new Date("2026-12-04T03:00:00.000Z"), 1)).toBe("2026-12-04");
    expect(louisianaDateAfter(new Date("2026-12-31T18:00:00.000Z"), 1)).toBe("2027-01-01");
    expect(louisianaDateAfter(new Date("2026-03-07T18:00:00.000Z"), 2)).toBe("2026-03-09");
  });
});

describe("meeting time copy", () => {
  it("names the day and time in Louisiana, not in the process's zone", () => {
    // 16:30 UTC on a Thursday in December is 10:30 AM in Louisiana.
    expect(fmtMeetingDay("2026-12-03T16:30:00.000Z")).toBe("Thu, Dec 3");
    expect(fmtMeetingDay("2026-12-03T16:30:00.000Z", true)).toBe("Thu, Dec 3, 2026");
    expect(fmtMeetingTime("2026-12-03T16:30:00.000Z")).toBe("10:30 AM");
    // Late evening UTC-wise early morning: the Louisiana day is the one before.
    expect(fmtMeetingDay("2026-07-15T02:15:00.000Z")).toBe("Tue, Jul 14");
    expect(fmtMeetingTime("2026-07-15T02:15:00.000Z")).toBe("9:15 PM");
    expect(fmtMeetingTime("2026-07-14T17:00:00.000Z")).toBe("12:00 PM");
    expect(fmtMeetingTime("2026-07-14T05:05:00.000Z")).toBe("12:05 AM");
  });

  it("writes a span with one period when both ends share it", () => {
    expect(fmtMeetingSpan("2026-12-03T16:30:00.000Z", "2026-12-03T17:15:00.000Z")).toBe("Thu, Dec 3 · 10:30 to 11:15 AM");
    expect(fmtMeetingSpan("2026-12-03T17:30:00.000Z", "2026-12-03T18:15:00.000Z")).toBe(
      "Thu, Dec 3 · 11:30 AM to 12:15 PM",
    );
  });

  it("says how long in words", () => {
    expect(fmtDuration(45)).toBe("45 minutes");
    expect(fmtDuration(60)).toBe("1 hour");
    expect(fmtDuration(90)).toBe("1 hour 30 minutes");
    expect(fmtDuration(180)).toBe("3 hours");
  });
});
