import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { demoSnapshot } from "../data/demo";
import { FinancialDashboard } from "../features/coach/FinancialDashboard";
import { ActorBuilder } from "./ActorBuilder";
import { InteractiveCalendarGrid } from "./InteractiveCalendarGrid";
const reads = vi.hoisted(() => ({ financial: vi.fn() }));
vi.mock("../hooks/usePrivateIdentity", () => ({
  usePrivateIdentity: () => "test-identity",
}));
vi.mock("../data/studioOperations", () => ({
  loadFinancialDashboard: reads.financial,
}));
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
beforeEach(() => {
  reads.financial.mockReset();
});
it("opens currency-specific authoritative supporting records and fails without invented zeroes", async () => {
  const user = userEvent.setup(),
    data = {
      month: "2031-02-01",
      timezone: "America/New_York",
      from: "2031-02-01T05:00:00Z",
      until: "2031-03-01T05:00:00Z",
      evaluatedAt: "2031-02-02T10:00:00Z",
      totals: [
        {
          metric: "outstanding",
          currency: "USD",
          unit: "money",
          amount: 8000,
          count: 1,
        },
        {
          metric: "outstanding",
          currency: "EUR",
          unit: "money",
          amount: 700,
          count: 1,
        },
      ],
      items: [
        {
          metric: "outstanding",
          currency: "USD",
          unit: "money",
          amount: 8000,
          id: crypto.randomUUID(),
          student_id: crypto.randomUUID(),
          title: "INV-1",
          state: "open",
          href: "/coach/students/authorized/payments?invoice=exact",
          occurred_at: "2031-02-01T12:00:00Z",
        },
      ],
      count: 1,
      page: 1,
    };
  reads.financial.mockResolvedValue(data);
  const rendered = wrap(
    <FinancialDashboard data={demoSnapshot} isDemo={false} />,
  );
  const heading = await screen.findByRole("heading", {
    name: "Outstanding invoices",
  });
  await user.click(
    within(heading.closest("article")!).getByRole("button", { name: /80.00/ }),
  );
  expect(await screen.findByRole("link", { name: "INV-1" })).toHaveAttribute(
    "href",
    data.items[0].href,
  );
  expect(reads.financial).toHaveBeenLastCalledWith(
    expect.any(String),
    "outstanding",
    "USD",
    1,
    expect.any(AbortSignal),
  );
  rendered.unmount();
  reads.financial.mockRejectedValue(new Error("Denied"));
  wrap(<FinancialDashboard data={demoSnapshot} isDemo={false} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Financial totals unavailable",
  );
  expect(screen.queryByText("No matching records")).not.toBeInTheDocument();
});
describe("calendar proposals", () => {
  it("moves and resizes through proposals while authoritative event times stay intact", () => {
    const propose = vi.fn(),
      lesson = {
        ...demoSnapshot.lessons[0],
        id: "test-lesson",
        topic: "Coaching",
        status: "scheduled" as const,
        startsAt: "2031-01-07T15:00:00Z",
        endsAt: "2031-01-07T16:00:00Z",
      };
    wrap(
      <InteractiveCalendarGrid
        days={[new Date(2031, 0, 7, 12)]}
        lessons={[lesson]}
        timezone="America/New_York"
        studentName={() => "Synthetic learner"}
        onOpen={() => {}}
        onPropose={propose}
      />,
    );
    const slot = screen.getByRole("button", {
      name: "Create lesson 2031-01-07 09:00 America/New_York",
    });
    fireEvent.drop(slot, { dataTransfer: { getData: () => lesson.id } });
    expect(propose.mock.calls[0][0]).toMatchObject({
      kind: "move",
      startsAt: "2031-01-07T14:00:00.000Z",
    });
    expect(lesson.startsAt).toBe("2031-01-07T15:00:00Z");
    fireEvent.keyDown(screen.getByRole("button", { name: "Resize Coaching" }), {
      key: "ArrowDown",
    });
    expect(propose.mock.calls[1][0]).toMatchObject({
      kind: "resize",
      endsAt: "2031-01-07T16:15:00.000Z",
    });
    expect(lesson.endsAt).toBe("2031-01-07T16:00:00Z");
  });
});
it("previews both Actor layouts and reorders sections without publishing", async () => {
  const user = userEvent.setup(),
    save = vi.fn().mockResolvedValue(undefined),
    profile = {
      ...demoSnapshot.actorProfiles[0],
      status: "published" as const,
      publishedRevisionId: "retained-revision",
    };
  wrap(
    <ActorBuilder
      profile={profile}
      materials={[]}
      studioName="Synthetic Studio"
      onClose={() => {}}
      onSave={save}
    />,
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Layout" }),
    "spotlight",
  );
  await user.click(screen.getByRole("button", { name: "Move media up" }));
  expect(document.querySelector(".actor-layout-spotlight")).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(save.mock.calls[0][2].presentation).toMatchObject({
    layout: "spotlight",
    sections: ["biography", "headshots", "credits", "media", "skills"],
  });
  expect(profile.publishedRevisionId).toBe("retained-revision");
});
