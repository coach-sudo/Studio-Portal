import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ check: vi.fn(), command: vi.fn() }));
vi.mock("../../data/bookingCommands", () => ({
  checkSchedulingConflicts: f.check,
  studioCommand: f.command,
}));
vi.mock("../../hooks/usePrivateIdentity", () => ({
  usePrivateIdentity: () => "synthetic-coach",
}));
vi.mock("../../hooks/useStudio", () => ({ invalidateStudioDomains: vi.fn() }));
vi.mock("../../state/StudioStore", () => ({
  useStudioStore: () => ({ transact: vi.fn() }),
}));
import { CalendarProposalDialog } from "./CalendarProposalDialog";
import { demoSnapshot } from "../../data/demo";
import type { SchedulingConflict } from "../../domain/schedulingConflicts";
const lesson = {
  ...demoSnapshot.lessons[0],
  status: "scheduled" as const,
  offeringId: undefined,
  startsAt: "2031-11-03T18:00:00Z",
  endsAt: "2031-11-03T19:00:00Z",
};
const conflict: SchedulingConflict = {
  id: "other",
  summary: "Synthetic conflicting record",
  start: "2031-11-10T18:00:00Z",
  end: "2031-11-10T19:00:00Z",
  source: "studio",
  policy: "private_overlap",
  blocksChange: true,
};
beforeEach(() => {
  f.check.mockReset().mockResolvedValue([conflict]);
  f.command
    .mockReset()
    .mockRejectedValue(new Error("Synthetic review boundary"));
});
function mount(create = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <CalendarProposalDialog
        proposal={{
          kind: create ? "create" : "move",
          lesson: create ? undefined : lesson,
          startsAt: conflict.start,
          endsAt: conflict.end,
        }}
        data={demoSnapshot}
        isDemo={false}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  return { client, user };
}
it("does not offer a move/resize override or downstream review for a private exclusion", async () => {
  mount();
  await screen.findByRole("alert");
  expect(
    screen.getByText(/Scheduled private lessons cannot overlap/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Change scope")).not.toBeInTheDocument();
  expect(f.command).not.toHaveBeenCalled();
});
it("requires explicit Google overlap acknowledgement before its financial/occurrence review", async () => {
  f.check.mockResolvedValue([
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  const { user } = mount();
  const checkbox = await screen.findByRole("checkbox", {
    name: "I reviewed and authorize the Google busy-time overlap.",
  });
  expect(screen.queryByLabelText("Change scope")).not.toBeInTheDocument();
  await user.click(checkbox);
  await user.type(screen.getByLabelText("Reason"), "Synthetic Google overlap");
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await screen.findByRole("alert");
  expect(f.command).toHaveBeenCalledWith(
    "lessons",
    expect.objectContaining({
      command: "preview_change",
      payload: expect.objectContaining({ allowConflict: true }),
    }),
  );
});
it("keeps a studio advisory distinct from Google authority in downstream review", async () => {
  f.check.mockResolvedValue([
    { ...conflict, policy: "studio_advisory", blocksChange: false },
  ]);
  const { user } = mount();
  await user.click(
    await screen.findByRole("checkbox", {
      name: "I reviewed the advisory studio overlap.",
    }),
  );
  await user.type(screen.getByLabelText("Reason"), "Synthetic advisory");
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await screen.findByRole("alert");
  expect(f.command).toHaveBeenCalledWith(
    "lessons",
    expect.objectContaining({
      payload: expect.objectContaining({ allowConflict: false }),
    }),
  );
});
it("blocks a new private creation proposal without offering an override checkbox", async () => {
  mount(true);
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Review proposed lesson" }),
  ).toBeDisabled();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(f.command).not.toHaveBeenCalled();
});
it("blocks an old unclassified response rather than promising an override", async () => {
  f.check.mockResolvedValue([
    {
      id: conflict.id,
      summary: conflict.summary,
      start: conflict.start,
      end: conflict.end,
    },
  ]);
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The conflict policy could not be identified",
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("requires a new acknowledgement when a background refresh changes reviewed Google conflicts", async () => {
  f.check.mockResolvedValue([
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  const { user, client } = mount();
  await user.click(
    await screen.findByRole("checkbox", {
      name: "I reviewed and authorize the Google busy-time overlap.",
    }),
  );
  expect(screen.getByLabelText("Change scope")).toBeInTheDocument();
  f.check.mockResolvedValue([
    {
      ...conflict,
      id: "different",
      summary: "A newly observed conflict",
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  await client.invalidateQueries({ queryKey: ["calendar-proposal"] });
  await screen.findByText("A newly observed conflict");
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", {
        name: "I reviewed and authorize the Google busy-time overlap.",
      }),
    ).not.toBeChecked(),
  );
  expect(screen.queryByLabelText("Change scope")).not.toBeInTheDocument();
  expect(f.command).not.toHaveBeenCalled();
});
