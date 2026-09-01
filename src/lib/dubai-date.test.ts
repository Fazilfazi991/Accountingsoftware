import { describe, expect, it } from "vitest";
import { dubaiCalendarDate } from "./dubai-date";

describe("dubaiCalendarDate", () => {
  it.each([
    ["2026-09-01T00:15:00+04:00", "2026-09-01"],
    ["2026-09-01T23:45:00+04:00", "2026-09-01"],
  ])("keeps the Dubai calendar date for %s", (instant, expected) => {
    expect(dubaiCalendarDate(new Date(instant))).toBe(expected);
  });
});
