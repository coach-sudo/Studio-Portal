import { describe, expect, it } from "vitest";
import {
  formatStudioDate,
  formatStudioDateTime,
  formatStudioTime,
  materialDisplayKind,
  safeStudioTimezone,
  studioDateKey,
} from "./presentation";

describe("presentation helpers", () => {
  it("formats studio dates without seconds in the selected timezone", () => {
    const value = formatStudioDateTime(
      "2026-09-01T20:00:30.000Z",
      "America/New_York",
    );
    expect(value).toContain("4:00 PM");
    expect(value).not.toContain(":30");
  });

  it("keeps calendar dates stable at timezone and daylight-saving boundaries", () => {
    expect(
      studioDateKey("2026-03-08T04:30:00.000Z", "America/New_York"),
    ).toBe("2026-03-07");
    expect(
      formatStudioDate("2026-11-01T05:30:00.000Z", "America/New_York"),
    ).toContain("Nov 1, 2026");
  });

  it("groups the same instant by the selected studio day", () => {
    const instant = "2026-09-02T01:15:00.000Z";
    expect(studioDateKey(instant, "America/New_York")).toBe("2026-09-01");
    expect(studioDateKey(instant, "Asia/Tokyo")).toBe("2026-09-02");
  });

  it("omits seconds even when callers accidentally request them", () => {
    const value = formatStudioTime("2026-09-01T20:00:30.000Z", "UTC", {
      second: "2-digit",
    });
    expect(value).toBe("8:00 PM");
  });

  it("falls back safely when a stored timezone is invalid", () => {
    expect(safeStudioTimezone("Not/A_Zone")).toBe("America/New_York");
  });

  it("uses role and file evidence before unreliable media labels", () => {
    expect(
      materialDisplayKind({
        role: "actor_material",
        mediaKind: "document",
        title: "Headshot 1",
        category: "Script",
        externalUrl: "https://example.com/headshot.jpg",
      }),
    ).toBe("Headshot");
    expect(
      materialDisplayKind({
        role: "lesson_material",
        mediaKind: "image",
        title: "Scene notes",
        category: "Photo",
        externalUrl: "https://example.com/notes.jpg",
      }),
    ).toBe("Lesson resource");
  });
});
