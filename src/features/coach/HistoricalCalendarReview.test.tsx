import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useHistoricalCalendarReview } from "./useHistoricalCalendarReview";
import { HistoricalCalendarReview } from "./HistoricalCalendarReview";
import { ApiClientError } from "../../data/apiClientError";
vi.mock("../../data/reviewActor", () => ({
  captureReviewActor: () => Promise.resolve("original-coach"),
}));
const f = vi.hoisted(() => ({
  load: vi.fn(),
  lesson: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  history: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../../data/historicalCalendarReview", () => ({
  loadHistoricalSource: f.load,
  loadHistoricalLesson: f.lesson,
  previewHistoricalReconciliation: f.preview,
  saveHistoricalReview: f.save,
  loadHistoricalHistory: f.history,
}));
vi.mock("../../data/globalSearch", () => ({ searchRecords: f.search }));
const id = (n: number) =>
  `e8900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const candidate = { id: id(1), summary: "Past coaching signal" } as Parameters<
  ReturnType<typeof useHistoricalCalendarReview>["select"]
>[0];
const source = {
  candidateId: id(1),
  studioId: id(2),
  calendarId: "exact-calendar",
  eventId: "source-event",
  summary: candidate.summary,
  sourceStatus: "active",
  reasonCode: "event_detected",
  stamp: "a".repeat(64),
  observation: {
    startsAt: "2020-01-01T15:00Z",
    endsAt: "2020-01-01T16:00Z",
    startDate: null,
    endDate: null,
  },
  decision: null,
  priorSignals: [],
  linkedLessons: [],
  canonicalEffects: [],
  attendanceVerified: false,
  financialCoverageVerified: false,
};
const originalLesson = {
  id: id(5),
  version: 3,
  topic: "Paid completed original",
  startsAt: "2020-01-01T15:00Z",
  endsAt: "2020-01-01T16:00Z",
  status: "completed",
};
const receipt = {
  resource: {
    candidateId: id(1),
    decisionId: id(9),
    lessonId: null,
    disposition: "skipped",
    attendanceVerified: false,
    financialCoverageVerified: false,
  },
  auditEventId: id(8),
  queuedSideEffects: [],
};
function Harness({ onSaved }: { onSaved?: () => Promise<void> }) {
  const c = useHistoricalCalendarReview("America/New_York", onSaved);
  return (
    <>
      <button onClick={() => c.select(candidate)}>Open source</button>
      <HistoricalCalendarReview control={c} timezone="America/New_York" />
    </>
  );
}
const mount = (onSaved?: () => Promise<void>) =>
  render(
    <MemoryRouter>
      <Harness onSaved={onSaved} />
    </MemoryRouter>,
  );
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
async function open() {
  click("Open source");
  await screen.findByLabelText("Review action");
}
async function student() {
  change("Find original student", "Original");
  click("Search original students");
  await screen.findByRole("button", { name: "Original student" });
  click("Original student");
}
const reason = () =>
  change(
    "Reason for this source decision",
    "Coach verified original source identity",
  );
beforeEach(() => {
  vi.resetAllMocks();
  f.load.mockResolvedValue(source);
  f.save.mockResolvedValue(receipt);
  f.lesson.mockResolvedValue(originalLesson);
  f.search.mockImplementation(async (_q, _student, kind) => ({
    items: [
      {
        kind,
        id: kind === "student" ? id(4) : id(5),
        studentId: id(4),
        title:
          kind === "student" ? "Original student" : "Paid completed original",
        snippet: "",
      },
    ],
    moreGroups: [],
    page: 1,
  }));
  f.preview.mockImplementation(async (_id, proposal) => ({
    ...source,
    phase: "preview",
    proposal,
    student: { id: id(4), name: "Original student", version: 1 },
    target: proposal.action === "link" ? originalLesson : null,
    startsAt: proposal.startsAt || originalLesson.startsAt,
    endsAt: proposal.endsAt || originalLesson.endsAt,
    sourceDifference: false,
    sourceMatchCount: 0,
    intervalMatchCount: 0,
    sourceMatchExamples: [],
    intervalMatchExamples: [],
    examplesAreComplete: true,
    blockedReason: null,
    recordedOutcome: proposal.action === "create" ? "scheduled" : "completed",
    proposedCanonicalEffects:
      proposal.action === "create"
        ? ["historical_lesson", "confirmed_participant"]
        : [],
  }));
});
it("requires preview then explicit confirmation for a reasoned skip, without attendance or provider work", async () => {
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.load).toHaveBeenLastCalledWith(id(1), true, "original-coach");
  click("Confirm source decision");
  await screen.findByText("Source decision saved.");
  expect(f.save).toHaveBeenCalledOnce();
  expect(f.save.mock.calls[0][0]).toMatchObject({
    kind: "decision",
    candidateId: id(1),
    decision: {
      action: "skip",
      reason: expect.any(String),
      stamp: "a".repeat(64),
    },
  });
  expect(
    screen.getByText(
      /No lesson, attendance, payment or notification was created/,
    ),
  ).toBeInTheDocument();
});
it("reopens one exact ignored legacy signal only after explicit calendar acknowledgment", async () => {
  f.load.mockResolvedValue({
    ...source,
    priorSignals: [
      {
        id: id(3),
        status: "ignored",
        lessonId: null,
        updatedAt: "2020-02-01T00:00:00Z",
        matchType: "legacy_unscoped",
      },
    ],
  });
  mount();
  await open();
  change("Review action", "reopen");
  reason();
  change("Source decision to reopen", id(3));
  click("Preview source decision");
  await screen.findByText(/Confirm the selected legacy signal/);
  expect(f.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /I verified this exact legacy event/,
    }),
  );
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  click("Confirm source decision");
  await screen.findByText("Source decision saved.");
  expect(f.save.mock.calls[0][0].decision).toMatchObject({
    legacyImportId: id(3),
    legacyUpdatedAt: "2020-02-01T00:00:00Z",
    acknowledgeUnscoped: true,
    action: "reopen",
  });
});
it("records an explicitly chosen repeated-hour instant as scheduled history, with no attendance fields", async () => {
  mount();
  await open();
  change("Review action", "create");
  await student();
  reason();
  change("From", "2025-11-02T01:30");
  change("Until", "2025-11-02T02:30");
  change("Lesson topic", "Original historical lesson");
  change("Confirmed location or meeting description", "Historical studio");
  click("Preview source decision");
  expect(screen.getByLabelText("From repeated-hour occurrence")).toBeRequired();
  expect(f.preview).not.toHaveBeenCalled();
  change("From repeated-hour occurrence", "2025-11-02T06:30:00.000Z");
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  expect(f.preview.mock.calls[0][1]).toMatchObject({
    action: "create",
    startsAt: "2025-11-02T06:30:00.000Z",
    endsAt: "2025-11-02T07:30:00.000Z",
    timezone: "America/New_York",
  });
  expect(f.preview.mock.calls[0][1]).not.toHaveProperty("attendance");
  expect(screen.getByText(/Outcome:/)).toHaveTextContent(
    "Scheduled historical",
  );
});
it("links an original completed lesson by exact version and preserves its outcome", async () => {
  f.save.mockResolvedValue({
    ...receipt,
    resource: {
      ...receipt.resource,
      lessonId: id(5),
      linked: true,
      created: false,
      recordedOutcome: "completed",
    },
  });
  mount();
  await open();
  await student();
  change("Find existing lesson", "Paid");
  click("Search this student's lessons");
  await screen.findByRole("button", { name: "Paid completed original" });
  click("Paid completed original");
  await screen.findByText(/Selected: Paid completed original/);
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  expect(f.preview.mock.calls[0][1]).toMatchObject({
    studentId: id(4),
    lessonId: id(5),
    lessonVersion: 3,
    action: "link",
  });
  click("Confirm source decision");
  await screen.findByText(/financial history were preserved/);
  expect(
    screen.getByRole("link", { name: "Open saved original lesson" }),
  ).toHaveAttribute("href", "/coach/records/lesson/" + id(5));
});
it("retains the entire request and key after a lost save response, disabling edits until unchanged recovery", async () => {
  f.save.mockRejectedValueOnce(Error("Synthetic lost response"));
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  click("Confirm source decision");
  await screen.findByText("Synthetic lost response");
  const first = structuredClone(f.save.mock.calls[0][0]);
  expect(screen.getByLabelText("Review action")).toBeDisabled();
  expect(
    screen.getByLabelText("Reason for this source decision"),
  ).toBeDisabled();
  click("Recover unchanged source request");
  await screen.findByText("Source decision saved.");
  expect(f.save.mock.calls[1][0]).toEqual(first);
});
it("clears a rejected preview after confirmed validation failure while preserving the coach's input", async () => {
  f.save.mockRejectedValue(
    new ApiClientError(
      {
        code: "VALIDATION_FAILED",
        message: "Refresh exact source",
        retryable: false,
      },
      409,
    ),
  );
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  click("Confirm source decision");
  await screen.findByText("Refresh exact source");
  expect(
    screen.queryByRole("button", { name: "Confirm source decision" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Reason for this source decision")).toHaveValue(
    "Coach verified original source identity",
  );
  expect(screen.getByLabelText("Review action")).not.toBeDisabled();
});
it("invalidates a preview on any input edit before another save", async () => {
  mount();
  await open();
  change("Review action", "not_lesson");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  change(
    "Reason for this source decision",
    "Coach reviewed another exact reason",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm source decision" }),
  ).not.toBeInTheDocument();
  expect(f.save).not.toHaveBeenCalled();
});
it("reports a committed decision accurately if subsequent source refresh fails", async () => {
  f.load
    .mockResolvedValueOnce(source)
    .mockResolvedValueOnce(source)
    .mockRejectedValueOnce(Error("Refresh outage"));
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  click("Confirm source decision");
  await screen.findByText("Source decision saved.");
  await screen.findByText(/The source decision was saved. Refresh the preview/);
  expect(f.save).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: "Recover unchanged source request" }),
  ).not.toBeInTheDocument();
});
it("keeps server duplicate and identity holds visible and prevents confirmation", async () => {
  f.preview.mockImplementation(async (_id, proposal) => ({
    ...source,
    proposal,
    blockedReason: "student_identity_requires_review",
    student: { name: "Original student" },
    sourceMatchExamples: [],
    intervalMatchExamples: [],
    sourceMatchCount: 1,
    intervalMatchCount: 0,
    examplesAreComplete: true,
  }));
  mount();
  await open();
  change("Review action", "create");
  await student();
  reason();
  change("From", "2020-01-01T10:00");
  change("Until", "2020-01-01T11:00");
  change("Lesson topic", "Past");
  change("Confirmed location or meeting description", "Studio");
  click("Preview source decision");
  await screen.findByText(/The source belongs to another original student/);
  expect(
    screen.getByRole("button", { name: "Confirm source decision" }),
  ).toBeDisabled();
  expect(f.save).not.toHaveBeenCalled();
});

it("retains the reviewed actor and request after a changed-session no-fetch rejection", async () => {
  f.save.mockRejectedValueOnce(
    Error(
      "The signed-in account changed. Return to the original account to recover this change.",
    ),
  );
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  expect(f.load).toHaveBeenLastCalledWith(id(1), true, "original-coach");
  click("Confirm source decision");
  await screen.findByText(/signed-in account changed/);
  expect(
    screen.getByLabelText("Reason for this source decision"),
  ).toBeDisabled();
  expect(f.save.mock.calls[0][0].actorId).toBe("original-coach");
  click("Recover unchanged source request");
  await screen.findByText("Source decision saved.");
  expect(f.save.mock.calls[1][0]).toEqual(f.save.mock.calls[0][0]);
});

it("preserves backend policy by disabling exclusion choices for a linked original lesson", async () => {
  f.load.mockResolvedValue({
    ...source,
    decision: {
      id: id(9),
      version: 2,
      disposition: "linked",
      lesson_id: id(5),
      reason: "Original link",
    },
  });
  mount();
  await open();
  expect(screen.getByRole("option", { name: "Not a lesson" })).toBeDisabled();
  expect(
    screen.getByRole("option", { name: "Skip with reason" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/This source already links an original lesson/),
  ).toBeVisible();
  expect(f.save).not.toHaveBeenCalled();
});

it.each(["FORBIDDEN", "IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT"])(
  "holds the unknown historical request through %s rather than creating a new intent",
  async (code) => {
    f.save
      .mockRejectedValueOnce(Error("Response lost"))
      .mockRejectedValueOnce(
        new ApiClientError(
          { code, message: "Original receipt recovery held", retryable: false },
          409,
        ),
      );
    mount();
    await open();
    change("Review action", "skip");
    reason();
    click("Preview source decision");
    await screen.findByRole("region", { name: "Source decision preview" });
    click("Confirm source decision");
    await screen.findByText("Response lost");
    click("Recover unchanged source request");
    await screen.findByText("Original receipt recovery held");
    expect(
      screen.getByLabelText("Reason for this source decision"),
    ).toBeDisabled();
    click("Recover unchanged source request");
    await screen.findByText("Source decision saved.");
    expect(f.save.mock.calls[1][0]).toEqual(f.save.mock.calls[0][0]);
    expect(f.save.mock.calls[2][0]).toEqual(f.save.mock.calls[0][0]);
  },
);

it("holds even a first VERSION_CONFLICT because the shared API also uses it for key conflicts", async () => {
  f.save.mockRejectedValueOnce(
    new ApiClientError(
      {
        code: "VERSION_CONFLICT",
        message: "Conflicting retained request",
        retryable: false,
      },
      409,
    ),
  );
  mount();
  await open();
  change("Review action", "skip");
  reason();
  click("Preview source decision");
  await screen.findByRole("region", { name: "Source decision preview" });
  click("Confirm source decision");
  await screen.findByText("Conflicting retained request");
  expect(
    screen.getByLabelText("Reason for this source decision"),
  ).toBeDisabled();
  click("Recover unchanged source request");
  await screen.findByText("Source decision saved.");
  expect(f.save.mock.calls[1][0]).toEqual(f.save.mock.calls[0][0]);
});
