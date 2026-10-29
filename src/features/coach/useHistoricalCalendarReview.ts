import { captureReviewActor } from "../../data/reviewActor";
import { useRef, useState } from "react";
import { ApiClientError } from "../../data/apiClientError";
import { searchRecords, type SearchPage } from "../../data/globalSearch";
import {
  loadHistoricalSource,
  loadHistoricalLesson,
  loadHistoricalHistory,
  previewHistoricalReconciliation,
  saveHistoricalReview,
  type HistoricalPending,
} from "../../data/historicalCalendarReview";
import {
  historicalProposalSchema,
  type HistoricalSource,
  type HistoricalPreview,
  type HistoricalLesson,
  type HistoricalReceipt,
  type HistoricalHistory,
} from "../../domain/historicalCalendarReview";
import type { DiscoveryCandidate } from "../../domain/calendarDiscovery";
import { formatZonedInput, zonedInputInstants } from "../../domain/zonedInput";
type Fields = {
  action: "link" | "create" | "reopen" | "not_lesson" | "skip";
  reason: string;
  studentQuery: string;
  lessonQuery: string;
  studentId: string;
  studentName: string;
  lesson?: HistoricalLesson;
  from: string;
  to: string;
  fromFold: string;
  toFold: string;
  topic: string;
  locationType: "in_person" | "virtual";
  locationLabel: string;
  sourceAck: boolean;
  duplicateAck: boolean;
  ignoredId: string;
  unscopedAck: boolean;
};
const initial: Fields = {
  action: "link",
  reason: "",
  studentQuery: "",
  lessonQuery: "",
  studentId: "",
  studentName: "",
  from: "",
  to: "",
  fromFold: "",
  toFold: "",
  topic: "",
  locationType: "in_person",
  locationLabel: "",
  sourceAck: false,
  duplicateAck: false,
  ignoredId: "",
  unscopedAck: false,
};
type Review = {
  request: HistoricalPending;
  preview?: HistoricalPreview;
  source: HistoricalSource;
};
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Review could not finish. Your input is retained.";
export function useHistoricalCalendarReview(
  timezone: string,
  onSaved?: () => Promise<void>,
) {
  const [candidate, setCandidate] = useState<DiscoveryCandidate>(),
    [source, setSource] = useState<HistoricalSource>(),
    [fields, setFields] = useState<Fields>(initial),
    [students, setStudents] = useState<SearchPage>(),
    [lessons, setLessons] = useState<SearchPage>(),
    [review, setReview] = useState<Review>(),
    [pending, setPending] = useState<HistoricalPending>(),
    [receipt, setReceipt] = useState<HistoricalReceipt>(),
    [history, setHistory] = useState<HistoricalHistory>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useRef(false),
    fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const perform = async (action: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const edit = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    if (guard.current || pending) return;
    setFields((current) => ({
      ...current,
      [key]: value,
      ...(key === "studentId" ? { lesson: undefined } : {}),
      ...(key === "from" ? { fromFold: "" } : {}),
      ...(key === "to" ? { toFold: "" } : {}),
      ...(key === "ignoredId" ? { unscopedAck: false } : {}),
      ...(["action", "studentId", "from", "to", "fromFold", "toFold"].includes(
        key,
      )
        ? { sourceAck: false, duplicateAck: false }
        : {}),
    }));
    setReview(undefined);
    setReceipt(undefined);
    setError("");
    if (key === "studentQuery") setStudents(undefined);
    if (key === "lessonQuery") setLessons(undefined);
  };
  const select = (item: DiscoveryCandidate) => {
    if (pending) {
      setError(
        "Recover the previous source request unchanged before selecting another source.",
      );
      return;
    }
    if (guard.current) return;
    if (candidate?.id === item.id) return;
    setCandidate(item);
    setSource(undefined);
    setReview(undefined);
    setReceipt(undefined);
    setHistory(undefined);
    setStudents(undefined);
    setLessons(undefined);
    const wall = (value: string | null) => {
      try {
        return value ? formatZonedInput(value, timezone) : "";
      } catch {
        return "";
      }
    };
    setFields({
      ...initial,
      topic: item.summary,
      from: wall(item.startsAt),
      to: wall(item.endsAt),
    });
    void perform(async () => setSource(await loadHistoricalSource(item.id)));
  };
  const search = (kind: "student" | "lesson", more = false) =>
    void perform(async () => {
      const value = fieldsRef.current,
        query = kind === "student" ? value.studentQuery : value.lessonQuery,
        current = kind === "student" ? students : lessons;
      if (query.trim().length < 2)
        throw Error(
          "Enter at least two characters to search original records.",
        );
      if (kind === "lesson" && !value.studentId)
        throw Error("Choose the original student first.");
      const result = await searchRecords(
        query,
        kind === "lesson" ? value.studentId : undefined,
        kind,
        more ? (current?.page || 1) + 1 : 1,
      );
      if (
        result.items.some(
          (row) =>
            row.kind !== kind ||
            (kind === "lesson" && row.studentId !== value.studentId),
        )
      )
        throw Error(
          "The returned records do not match this student and search. Refresh before selecting.",
        );
      const next =
        more && current
          ? {
              ...result,
              items: [...current.items, ...result.items].filter(
                (row, i, all) => all.findIndex((x) => x.id === row.id) === i,
              ),
            }
          : result;
      if (kind === "student") setStudents(next);
      else setLessons(next);
    });
  const chooseStudent = (row: SearchPage["items"][number]) => {
    if (guard.current || pending) return;
    setFields((v) => ({
      ...v,
      studentId: row.id,
      studentName: row.title,
      sourceAck: false,
      duplicateAck: false,
      lesson: undefined,
      lessonQuery: "",
    }));
    setLessons(undefined);
    setReview(undefined);
    setReceipt(undefined);
  };
  const chooseLesson = (id: string) =>
    void perform(async () => {
      const lesson = await loadHistoricalLesson(id);
      if (Date.parse(lesson.endsAt) > Date.now())
        throw Error(
          "Choose a historical lesson. Upcoming lessons use the scheduling workflow.",
        );
      setFields((v) => ({
        ...v,
        lesson,
        sourceAck: false,
        duplicateAck: false,
      }));
      setReview(undefined);
      setReceipt(undefined);
    });
  const prepare = () =>
    void perform(async () => {
      if (!candidate || pending) return;
      const f = fieldsRef.current,
        reason = f.reason.trim();
      if (reason.length < 3 || reason.length > 500)
        throw Error("Enter a reason between 3 and 500 characters.");
      setReview(undefined);
      setReceipt(undefined);
      const actorId = await captureReviewActor();
      if (f.action === "link" || f.action === "create") {
        if (!f.studentId)
          throw Error(
            "Search and choose the original student. Related profiles remain separate.",
          );
        const common = {
          studentId: f.studentId,
          reason,
          acknowledgeSourceDifference: f.sourceAck,
          acknowledgeDuplicateReview: f.duplicateAck,
        };
        const instant = (value: string, fold: string) => {
          const choices = zonedInputInstants(value, timezone);
          if (!choices.length)
            throw Error(
              "Choose a valid local time in the studio timezone; daylight-saving gaps are unavailable.",
            );
          if (choices.length > 1 && !choices.includes(fold))
            throw Error(
              "Choose the first or second occurrence of the repeated local hour.",
            );
          return choices.length === 1 ? choices[0] : fold;
        };
        if (f.action === "link" && !f.lesson)
          throw Error(
            "Search and choose the exact existing historical lesson.",
          );
        const proposal = historicalProposalSchema.parse(
          f.action === "link"
            ? {
                ...common,
                action: "link",
                lessonId: f.lesson!.id,
                lessonVersion: f.lesson!.version,
              }
            : {
                ...common,
                action: "create",
                startsAt: instant(f.from, f.fromFold),
                endsAt: instant(f.to, f.toFold),
                timezone,
                topic: f.topic,
                locationType: f.locationType,
                locationLabel: f.locationLabel,
              },
        );
        if (
          proposal.action === "create" &&
          (Date.parse(proposal.endsAt) > Date.now() ||
            Date.parse(proposal.endsAt) <= Date.parse(proposal.startsAt))
        )
          throw Error(
            "Enter a past, increasing lesson interval. No attendance or payment is implied.",
          );
        const preview = await previewHistoricalReconciliation(
          candidate.id,
          proposal,
          actorId,
        );
        setReview({
          source: preview,
          preview,
          request: {
            actorId,
            kind: "canonical",
            candidateId: candidate.id,
            proposal,
            stamp: preview.stamp,
            key: crypto.randomUUID(),
          },
        });
      } else {
        const next = await loadHistoricalSource(
          candidate.id,
          f.action !== "reopen",
          actorId,
        );
        setSource(next);
        const ignored = next.priorSignals.filter((i) => i.status === "ignored"),
          selected = ignored.find((i) => i.id === f.ignoredId);
        if (
          f.action === "reopen" &&
          !selected &&
          (!next.decision || next.decision.disposition === "review")
        )
          throw Error(
            "Choose one exact ignored signal or an existing finalized source decision to reopen.",
          );
        if (f.action === "reopen" && f.ignoredId && !selected)
          throw Error(
            "The chosen ignored signal changed. Refresh and review it again.",
          );
        if (selected?.matchType === "legacy_unscoped" && !f.unscopedAck)
          throw Error(
            "Confirm the selected legacy signal belongs to this exact calendar and event.",
          );
        const decision = {
          candidateId: candidate.id,
          stamp: next.stamp,
          action: f.action,
          reason,
          ...(f.action === "reopen" && selected
            ? {
                legacyImportId: selected.id,
                legacyUpdatedAt: selected.updatedAt,
                ...(selected.matchType === "legacy_unscoped"
                  ? { acknowledgeUnscoped: true }
                  : {}),
              }
            : {}),
        };
        setReview({
          source: next,
          request: {
            actorId,
            kind: "decision",
            candidateId: candidate.id,
            decision,
            key: crypto.randomUUID(),
          },
        });
      }
    });
  const save = () =>
    void perform(async () => {
      const request = pending || review?.request;
      if (!request) return;
      if (review?.preview?.blockedReason && !pending) return;
      setPending(request);
      let saved: HistoricalReceipt;
      try {
        saved = await saveHistoricalReview(request);
      } catch (e) {
        if (
          !pending &&
          e instanceof ApiClientError &&
          ["REVIEW_REQUIRED", "VALIDATION_FAILED"].includes(e.code)
        ) {
          setPending(undefined);
          setReview(undefined);
        }
        throw e;
      }
      setReceipt(saved);
      setFields((v) => ({
        ...v,
        ignoredId: "",
        unscopedAck: false,
        sourceAck: false,
        duplicateAck: false,
      }));
      setPending(undefined);
      setReview(undefined);
      try {
        setSource(await loadHistoricalSource(request.candidateId));
        if (onSaved) await onSaved();
      } catch {
        setError(
          "The source decision was saved. Refresh the preview to load its latest state; do not submit another decision to refresh it.",
        );
      }
    });
  const refresh = () =>
    void perform(async () => {
      if (candidate && !pending) {
        setSource(await loadHistoricalSource(candidate.id));
        setReview(undefined);
      }
    });
  const readHistory = (more = false) =>
    void perform(async () => {
      if (!candidate) return;
      const next = await loadHistoricalHistory(
        candidate.id,
        more ? history?.nextBeforeVersion || undefined : undefined,
      );
      setHistory(
        more && history
          ? {
              ...next,
              items: [...history.items, ...next.items].filter(
                (row, i, all) =>
                  all.findIndex((x) => x.version === row.version) === i,
              ),
            }
          : next,
      );
    });
  return {
    candidate,
    source,
    fields,
    edit,
    select,
    students,
    lessons,
    search,
    chooseStudent,
    chooseLesson,
    review,
    pending,
    receipt,
    history,
    busy,
    error,
    prepare,
    save,
    refresh,
    readHistory,
    locked: busy || !!pending,
  };
}
export type HistoricalReviewController = ReturnType<
  typeof useHistoricalCalendarReview
>;
