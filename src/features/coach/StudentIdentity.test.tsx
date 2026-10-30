import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StudentIdentityDialog, StudentIdentityLinks } from "./StudentIdentity";
import { ApiClientError } from "../../data/apiClientError";
vi.mock("../../data/reviewActor", () => ({
  captureReviewActor: () => Promise.resolve("original-coach"),
}));
const f = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../../data/studentIdentity", () => ({
  previewStudentIdentity: f.preview,
  saveStudentIdentity: f.save,
  loadStudentIdentity: f.load,
}));
const current = "e8700000-0000-4000-8000-000000000010",
  duplicate = "e8700000-0000-4000-8000-000000000011",
  groupId = "e8700000-0000-4000-8000-000000000040";
const students = [
  { id: current, fullName: "Alex Current" },
  { id: duplicate, fullName: "Alex Original" },
];
const makePreview = (proposal: unknown) => ({
  phase: "preview",
  stamp: "a".repeat(64),
  proposal,
  blockedReason: null,
  currentProfile: { id: current, name: "Alex Current", version: 1 },
  duplicateProfile: { id: duplicate, name: "Alex Original", version: 1 },
  group: null,
});
const member = (studentId = current) => ({
  studentId,
  name: studentId === current ? "Alex Current" : "Alex Original",
  status: "active",
  deletedAt: null,
  isCurrent: studentId === current,
});
const makeGroup = (version = 1) => ({
  group: { id: groupId, version, currentStudentId: current },
  members: [member()],
  total: 2,
  hasMore: true,
  nextAfterStudent: current,
  financialAccountsRemainSeparate: true,
  permissionsRemainSeparate: true,
});
beforeEach(() => {
  vi.clearAllMocks();
  f.preview.mockImplementation(async (proposal) => makePreview(proposal));
  f.save.mockResolvedValue({ resource: { active: true } });
  f.load.mockResolvedValue(makeGroup());
});
function dialog(onSaved = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <MemoryRouter>
      <StudentIdentityDialog
        students={students}
        open
        loading={false}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </MemoryRouter>,
  );
}
async function review() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Current profile"), current);
  await user.selectOptions(
    screen.getByLabelText("Related duplicate"),
    duplicate,
  );
  await user.type(
    screen.getByLabelText("Reason"),
    "Reviewed the original records",
  );
  await user.click(screen.getByRole("button", { name: "Review change" }));
  await screen.findByRole("button", { name: "Confirm profile links" });
  return user;
}
it("requires review before a write and sends only the exact reviewed proposal", async () => {
  dialog();
  const user = await review();
  expect(f.save).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByText(/Profiles linked\./);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.save.mock.calls[0][0]).toEqual(f.preview.mock.calls[0][0]);
  expect(
    screen.getByRole("link", { name: "Open original related profile" }),
  ).toHaveAttribute("href", "/coach/students/" + duplicate);
});
it("holds the exact request after an unknown result and replays the same key", async () => {
  f.save.mockRejectedValueOnce(Error("Response lost"));
  dialog();
  const user = await review();
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByRole("button", { name: "Retry saved request" });
  expect(screen.getByLabelText("Reason")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry saved request" }));
  await screen.findByText(/Profiles linked\./);
  expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);
});
it("invalidates a review when the coach changes a selection or reason", async () => {
  dialog();
  const user = await review();
  await user.type(screen.getByLabelText("Reason"), " amended");
  expect(
    screen.queryByRole("button", { name: "Confirm profile links" }),
  ).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});
it("retains input after a confirmed validation rejection", async () => {
  f.save.mockRejectedValueOnce(
    new ApiClientError(
      {
        code: "VALIDATION_FAILED",
        message: "Refresh review",
        retryable: false,
      },
      409,
    ),
  );
  dialog();
  const user = await review();
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByRole("button", { name: "Review change" });
  expect(screen.getByLabelText("Reason")).toHaveValue(
    "Reviewed the original records",
  );
  expect(screen.getByLabelText("Reason")).not.toBeDisabled();
});
it("a refresh failure after commit still reports saved success", async () => {
  dialog(vi.fn().mockRejectedValue(Error("List unavailable")));
  const user = await review();
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByText(/Profiles linked\./);
  await screen.findByText(/Saved successfully\. Refreshing/);
  expect(
    screen.queryByRole("button", { name: "Retry saved request" }),
  ).toBeNull();
});
it("permission/account holds cannot offer confirmation", async () => {
  f.preview.mockImplementation(async (p) => ({
    ...makePreview(p),
    blockedReason: "different_authenticated_users",
  }));
  dialog();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Current profile"), current);
  await user.selectOptions(
    screen.getByLabelText("Related duplicate"),
    duplicate,
  );
  await user.type(screen.getByLabelText("Reason"), "Reviewed account owners");
  await user.click(screen.getByRole("button", { name: "Review change" }));
  expect(await screen.findByText(/different signed-in accounts/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Confirm profile links" }),
  ).toBeDisabled();
});
it("related-profile navigation retains each original student ID and cursor", async () => {
  f.load.mockResolvedValueOnce(makeGroup()).mockResolvedValueOnce({
    ...makeGroup(),
    members: [member(duplicate)],
    hasMore: false,
    nextAfterStudent: null,
  });
  render(
    <MemoryRouter>
      <StudentIdentityLinks studentId={current} />
    </MemoryRouter>,
  );
  await screen.findByRole("link", { name: "Alex Current" });
  await userEvent.click(
    screen.getByRole("button", { name: "Load more related profiles" }),
  );
  await screen.findByRole("link", { name: "Alex Original" });
  expect(f.load.mock.calls[1]).toEqual([current, current]);
  expect(screen.getByRole("link", { name: "Alex Original" })).toHaveAttribute(
    "href",
    "/coach/students/" + duplicate,
  );
});
it("a disabled demo does not invent a server identity group", () => {
  render(
    <MemoryRouter>
      <StudentIdentityLinks studentId={current} enabled={false} />
    </MemoryRouter>,
  );
  expect(f.load).not.toHaveBeenCalled();
});
it("a changed group version restarts pagination at its first page", async () => {
  f.load
    .mockResolvedValueOnce(makeGroup())
    .mockResolvedValueOnce({ ...makeGroup(2), members: [member(duplicate)] })
    .mockResolvedValueOnce({
      ...makeGroup(2),
      members: [member(duplicate)],
      total: 1,
      hasMore: false,
      nextAfterStudent: null,
    });
  render(
    <MemoryRouter>
      <StudentIdentityLinks studentId={current} />
    </MemoryRouter>,
  );
  await screen.findByRole("link", { name: "Alex Current" });
  await userEvent.click(
    screen.getByRole("button", { name: "Load more related profiles" }),
  );
  await screen.findByRole("link", { name: "Alex Original" });
  expect(f.load.mock.calls[2]).toEqual([current]);
  expect(screen.queryByRole("link", { name: "Alex Current" })).toBeNull();
});
it("a related-group read failure offers recovery instead of an empty success", async () => {
  f.load.mockRejectedValueOnce(Error("History unavailable"));
  render(
    <MemoryRouter>
      <StudentIdentityLinks studentId={current} />
    </MemoryRouter>,
  );
  await screen.findByRole("alert");
  await userEvent.click(
    screen.getByRole("button", { name: "Retry related profiles" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Alex Current" })).toBeVisible(),
  );
});

it("retains the original actor and review after a changed-session no-fetch rejection", async () => {
  f.save.mockRejectedValueOnce(
    Error(
      "The signed-in account changed. Return to the original account to recover this change.",
    ),
  );
  dialog();
  const user = await review();
  expect(f.preview.mock.calls[0][1]).toBe("original-coach");
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByText(/signed-in account changed/);
  expect(screen.getByLabelText("Reason")).toBeDisabled();
  expect(f.save.mock.calls[0][3]).toBe("original-coach");
  await user.click(screen.getByRole("button", { name: "Retry saved request" }));
  await screen.findByText(/Profiles linked\./);
  expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);
  expect(f.preview).toHaveBeenCalledOnce();
});

it.each(["FORBIDDEN", "IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT"])(
  "retains an unknown identity attempt through %s and recovers the original receipt",
  async (code) => {
    f.save
      .mockRejectedValueOnce(Error("Response lost"))
      .mockRejectedValueOnce(
        new ApiClientError(
          { code, message: "Original receipt recovery held", retryable: false },
          409,
        ),
      );
    dialog();
    const user = await review();
    await user.click(
      screen.getByRole("button", { name: "Confirm profile links" }),
    );
    await screen.findByRole("button", { name: "Retry saved request" });
    await user.click(
      screen.getByRole("button", { name: "Retry saved request" }),
    );
    await screen.findByText("Original receipt recovery held");
    expect(screen.getByLabelText("Reason")).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Retry saved request" }),
    );
    await screen.findByText(/Profiles linked\./);
    expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);
    expect(f.save.mock.calls[2]).toEqual(f.save.mock.calls[0]);
    expect(f.preview).toHaveBeenCalledOnce();
  },
);

it("holds a first conflated version/key conflict without issuing a new identity request", async () => {
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
  dialog();
  const user = await review();
  await user.click(
    screen.getByRole("button", { name: "Confirm profile links" }),
  );
  await screen.findByText("Conflicting retained request");
  expect(screen.getByLabelText("Reason")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry saved request" }));
  await screen.findByText(/Profiles linked\./);
  expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);
  expect(f.preview).toHaveBeenCalledOnce();
});
