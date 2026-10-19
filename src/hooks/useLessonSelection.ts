import { useEffect, useState } from "react";

export type LessonSelection =
  | { mode: "ids"; ids: Set<string> }
  | { mode: "matching"; total: number; excluded: Set<string> };
export const emptyLessonSelection = (): LessonSelection => ({
  mode: "ids",
  ids: new Set(),
});
export const lessonSelectionCount = (value: LessonSelection) =>
  value.mode === "ids" ? value.ids.size : value.total - value.excluded.size;
export const lessonIsSelected = (value: LessonSelection, id: string) =>
  value.mode === "ids" ? value.ids.has(id) : !value.excluded.has(id);
export function changeLessonSelection(
  value: LessonSelection,
  ids: string[],
  checked: boolean,
): LessonSelection {
  if (value.mode === "matching") {
    const excluded = new Set(value.excluded);
    ids.forEach((id) => (checked ? excluded.delete(id) : excluded.add(id)));
    return { ...value, excluded };
  }
  const selected = new Set(value.ids);
  ids.forEach((id) => (checked ? selected.add(id) : selected.delete(id)));
  return selected.size <= 5000 ? { mode: "ids", ids: selected } : value;
}

/** Context excludes page: moving between pages never changes the selected scope. */
export function useLessonSelection(context: string) {
  const [stored, setStored] = useState({
    context,
    value: emptyLessonSelection(),
  });
  const [announcement, setAnnouncement] = useState("");
  const value =
    stored.context === context ? stored.value : emptyLessonSelection();
  useEffect(() => {
    if (stored.context === context) return;
    if (lessonSelectionCount(stored.value))
      setAnnouncement(
        "Selection cleared because the lesson filters or student changed.",
      );
    setStored({ context, value: emptyLessonSelection() });
  }, [context, stored]);
  const update = (next: LessonSelection) => {
    setStored({ context, value: next });
    setAnnouncement(`${lessonSelectionCount(next)} lessons selected.`);
  };
  return {
    value,
    announcement,
    count: lessonSelectionCount(value),
    isSelected: (id: string) => lessonIsSelected(value, id),
    toggle: (ids: string[], checked: boolean) => {
      const next = changeLessonSelection(value, ids, checked);
      if (checked && next === value)
        setAnnouncement(
          "Select at most 5,000 lessons. Narrow the selection first.",
        );
      else update(next);
    },
    allMatching: (total: number) =>
      update({ mode: "matching", total, excluded: new Set() }),
    clear: () => update(emptyLessonSelection()),
  };
}
