import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { demoSnapshot } from "../../data/demo";

const mock = vi.hoisted(() => ({
  snapshot: vi.fn(),
  report: vi.fn(),
  attention: vi.fn(),
}));
vi.mock("../../data/repository", async (original) => ({
  ...(await original<typeof import("../../data/repository")>()),
  loadStudioSnapshot: mock.snapshot,
}));
vi.mock("../../lib/supabase", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  supabase: null,
}));
vi.mock("../../data/financeCenter", async (original) => ({
  ...(await original<typeof import("../../data/financeCenter")>()),
  useFinanceReport: mock.report,
  useFinanceAttention: mock.attention,
}));
vi.mock("./StudioOperations", async () => {
  const { FinanceCenter } = await import("./FinanceCenter");
  return {
    FinanceView: (
      props: Omit<ComponentProps<typeof FinanceCenter>, "packages">,
    ) => <FinanceCenter {...props} packages={null} />,
  };
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["/coach/finance?report=collections", "report"],
  ["/coach/finance?view=attention", "attention"],
] as const)(
  "uses authorized V2 student options and filters %s",
  async (path, query) => {
    vi.resetModules();
    vi.stubEnv("VITE_QUERY_LAYER_V2", "true");
    const [{ CoachSection }, { StudioStoreProvider }] = await Promise.all([
      import("./CoachSection"),
      import("../../state/StudioStore"),
    ]);
    const [authorized, otherStudio] = demoSnapshot.students;
    mock.snapshot
      .mockReset()
      .mockImplementation(async (_role, _id, domains: string[]) => ({
        ...demoSnapshot,
        // The V2 RPC returns coach roster data only for the authorized students domain.
        students: domains.includes("students") ? [authorized] : [],
        linkedContacts: [],
      }));
    mock.report.mockReset().mockReturnValue({
      data: {
        totals: [],
        trend: [],
        services: [],
        reportTotals: [],
        rows: [],
        count: 0,
      },
    });
    mock.attention
      .mockReset()
      .mockReturnValue({ data: { items: [], count: 0 } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StudioStoreProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/coach/:section" element={<CoachSection />} />
            </Routes>
          </MemoryRouter>
        </StudioStoreProvider>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole("combobox", { name: "Student" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((x) => x.textContent),
    ).toEqual(["All students", authorized.fullName]);
    expect(
      within(select).queryByRole("option", { name: otherStudio.fullName }),
    ).not.toBeInTheDocument();
    expect(
      mock.snapshot.mock.calls.map(([role, id, domains]) => [
        role,
        id,
        domains,
      ]),
    ).toEqual(expect.arrayContaining([["coach", undefined, ["students"]]]));
    expect(
      mock.snapshot.mock.calls.every(([, , domains]) => domains.length === 1),
    ).toBe(true);
    fireEvent.change(select, { target: { value: authorized.id } });
    const lastFilters = () =>
      mock[query].mock.calls.at(-1)?.[query === "report" ? 2 : 1];
    expect(lastFilters()).toMatchObject({ student: authorized.id });
    fireEvent.change(select, { target: { value: "" } });
    expect(lastFilters()).toMatchObject({ student: undefined });
  },
);
