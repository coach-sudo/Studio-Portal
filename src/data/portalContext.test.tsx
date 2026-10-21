import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { usePortalContexts } from "./portalContext";

const fixture = vi.hoisted(() => ({ allowed: true, reads: 0 }));
vi.mock("./globalSearch", () => ({ useSearchIdentity: () => "owner" }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: async () => {
        const student = {
          id: "e6600000-0000-4000-8000-000000000004",
          fullName: "Synthetic learner",
          isMinor: false,
          canViewWork: fixture.allowed,
          canViewFinance: true,
          canViewSchedule: true,
          canManageLessons: true,
          canManageProfile: true,
        };
        return {
          data: { items: [student], selected: student, hasMore: false },
          error: null,
        };
      },
    }),
  },
}));
const id = "e6600000-0000-4000-8000-000000000004";
function Consumer({ selected }: { selected?: string }) {
  usePortalContexts(selected, 1, true);
  const record = useQuery({
    queryKey: ["work", id],
    queryFn: async () => {
      fixture.reads++;
      return fixture.allowed ? "Authorized work" : "Access denied";
    },
    staleTime: Infinity,
  });
  return <p>{record.data || "Loading work"}</p>;
}
beforeEach(() => {
  fixture.allowed = true;
  fixture.reads = 0;
});

it("does not erase active record queries when initializing the selected-student URL", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (selected?: string) => (
    <QueryClientProvider client={client}>
      <Consumer selected={selected} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  expect(await screen.findByText("Authorized work")).toBeVisible();
  await waitFor(() =>
    expect(
      client.getQueryData(["portal-contexts", "owner", null, 1]),
    ).toBeTruthy(),
  );
  rendered.rerender(view(id));
  await waitFor(() =>
    expect(
      client.getQueryData(["portal-contexts", "owner", id, 1]),
    ).toBeTruthy(),
  );
  expect(screen.getByText("Authorized work")).toBeVisible();
  expect(fixture.reads).toBe(1);
  fixture.allowed = false;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["portal-contexts", "owner", id],
    });
  });
  expect(await screen.findByText("Access denied")).toBeVisible();
  expect(fixture.reads).toBe(2);
  expect(client.getQueryData(["work", id])).toBe("Access denied");
  client.clear();
});
