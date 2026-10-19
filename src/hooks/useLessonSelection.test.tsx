import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLessonSelection } from "./useLessonSelection";

describe("lesson selection across bounded pages", () => {
  it("retains individual selection across pages and deselects a visible page only", () => {
    const { result } = renderHook(() => useLessonSelection("student/filter"));
    act(() => result.current.toggle(["page-one-a", "page-one-b"], true));
    act(() => result.current.toggle(["page-two-a"], true));
    act(() => result.current.toggle(["page-one-a", "page-one-b"], false));
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected("page-two-a")).toBe(true);
    expect(result.current.isSelected("page-one-a")).toBe(false);
  });
  it("uses exclusions without materializing the matching set or changing its captured count", () => {
    const { result } = renderHook(() => useLessonSelection("all"));
    act(() => result.current.allMatching(5000));
    act(() => result.current.toggle(["last-page"], false));
    expect(result.current.count).toBe(4999);
    expect(
      result.current.value.mode === "matching" &&
        result.current.value.excluded.size,
    ).toBe(1);
    expect(result.current.isSelected("another-page")).toBe(true);
    act(() => result.current.toggle(["last-page"], true));
    expect(result.current.count).toBe(5000);
  });
  it("clears selection and announces filter/student/identity changes", () => {
    const { result, rerender } = renderHook(
      ({ context }) => useLessonSelection(context),
      { initialProps: { context: "coach/student-a/scheduled" } },
    );
    act(() => result.current.toggle(["a"], true));
    rerender({ context: "coach/student-a/cancelled" });
    expect(result.current.count).toBe(0);
    expect(result.current.announcement).toMatch(/Selection cleared/);
    act(() => result.current.allMatching(30));
    rerender({ context: "coach/student-b/cancelled" });
    expect(result.current.count).toBe(0);
    act(() => result.current.toggle(["b"], true));
    rerender({ context: "other-coach/student-b/cancelled" });
    expect(result.current.count).toBe(0);
  });
  it("rejects rather than truncates an oversized explicit selection", () => {
    const { result } = renderHook(() => useLessonSelection("all"));
    act(() =>
      result.current.toggle(
        Array.from({ length: 5000 }, (_, i) => `lesson-${i}`),
        true,
      ),
    );
    act(() => result.current.toggle(["one-too-many"], true));
    expect(result.current.count).toBe(5000);
    expect(result.current.isSelected("one-too-many")).toBe(false);
    expect(result.current.announcement).toMatch(/at most 5,000/);
  });
});
