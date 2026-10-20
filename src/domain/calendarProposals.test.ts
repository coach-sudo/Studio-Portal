import { describe, it, expect } from "vitest";
import {
  calendarSlot,
  moveCalendarLesson,
  resizeCalendarLesson,
} from "./calendarProposals";
import { demoSnapshot } from "../data/demo";
describe("calendar proposals", () => {
  it("preserves duration when moving across daylight saving and leaves the source unchanged", () => {
    const l = {
        ...demoSnapshot.lessons[0],
        startsAt: "2030-03-08T15:00:00Z",
        endsAt: "2030-03-08T16:00:00Z",
      },
      original = structuredClone(l);
    const p = moveCalendarLesson(l, "2030-03-11", 10 * 60, "America/New_York");
    expect(p.startsAt).toBe("2030-03-11T14:00:00.000Z");
    expect(Date.parse(p.endsAt) - Date.parse(p.startsAt)).toBe(3600000);
    expect(l).toEqual(original);
  });
  it("rejects a nonexistent spring-forward wall time", () => {
    expect(() => calendarSlot("2030-03-10", 150, "America/New_York")).toThrow(
      /does not exist/,
    );
  });
  it("resizes only the proposal, bounded to supported gesture lengths", () => {
    const l = {
      ...demoSnapshot.lessons[0],
      startsAt: "2030-03-08T15:00:00Z",
      endsAt: "2030-03-08T16:00:00Z",
    };
    expect(resizeCalendarLesson(l, 15).endsAt).toBe("2030-03-08T16:15:00.000Z");
    expect(l.endsAt).toBe("2030-03-08T16:00:00Z");
    expect(() => resizeCalendarLesson(l, -60)).toThrow();
  });
});
