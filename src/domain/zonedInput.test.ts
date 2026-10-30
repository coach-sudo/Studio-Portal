import { expect, it } from "vitest";
import { formatZonedInput, zonedInputInstants } from "./zonedInput";
it("formats local control values independently of the host timezone", () => {
  expect(formatZonedInput("2026-10-27T18:00:00Z", "America/New_York")).toBe(
    "2026-10-27T14:00",
  );
  expect(zonedInputInstants("2026-10-27T14:00", "America/New_York")).toEqual([
    "2026-10-27T18:00:00.000Z",
  ]);
  expect(zonedInputInstants("2026-10-28T03:00", "Asia/Tokyo")).toEqual([
    "2026-10-27T18:00:00.000Z",
  ]);
  expect(zonedInputInstants("2026-10-27T23:30", "Asia/Kolkata")).toEqual([
    "2026-10-27T18:00:00.000Z",
  ]);
  expect(zonedInputInstants("2020-01-01T10:00", "America/New_York")).toEqual([
    "2020-01-01T15:00:00.000Z",
  ]);
});
it("rejects impossible dates and DST gaps and exposes both repeated hours", () => {
  expect(zonedInputInstants("2026-02-30T10:00", "UTC")).toEqual([]);
  expect(zonedInputInstants("2026-03-08T02:30", "America/New_York")).toEqual(
    [],
  );
  expect(zonedInputInstants("2026-11-01T01:30", "America/New_York")).toEqual([
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
  expect(zonedInputInstants("2026-10-27T14:00", "")).toEqual([]);
  expect(zonedInputInstants("2026-10-27T14:00", "Not/A_Zone")).toEqual([]);
});
