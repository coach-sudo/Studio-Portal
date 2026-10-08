import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { demoSnapshot } from "./demo";
import type { ResourceSearch } from "../domain/library";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: mock.rpc },
  isSupabaseConfigured: true,
}));
import { loadResourcePage, useResourceSearch } from "./library";
const request: ResourceSearch = {
  studioId: "studio",
  catalog: true,
  search: "",
  filters: { level: ["beginner", "intermediate"], topic: ["shakespeare"] },
  status: "active",
  pinned: false,
  sort: "title",
};
const page = (title: string, index = 1) => ({
  items: [{ id: title, title }],
  total: 26,
  page: index,
  pageSize: 25,
});
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
beforeEach(() => mock.rpc.mockReset());
it("sends a bounded server query with combined classifications and cancellation", async () => {
  const signal = new AbortController().signal;
  const abortSignal = vi
    .fn()
    .mockResolvedValue({ data: page("lexicon"), error: null });
  mock.rpc.mockReturnValue({ abortSignal });
  await loadResourcePage({ ...request, visibility: "studio" }, 2, signal);
  expect(mock.rpc).toHaveBeenCalledWith(
    "search_material_resources",
    expect.objectContaining({
      p_limit: 25,
      p_page: 2,
      p_filters: {
        level: ["beginner", "intermediate"],
        topic: ["shakespeare"],
        visibility: ["studio"],
      },
    }),
  );
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
it("debounces typing and prevents a late old response replacing the newest results", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  mock.rpc.mockImplementation((_name, args) => ({
    abortSignal: () =>
      args.p_search === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            data: page(args.p_search || "initial"),
            error: null,
          }),
  }));
  const { result, rerender } = renderHook(
    ({ search }) =>
      useResourceSearch({ ...request, search }, demoSnapshot, false),
    { wrapper: wrapper(), initialProps: { search: "old" } },
  );
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(1));
  rerender({ search: "new" });
  rerender({ search: "newest" });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(result.current.data?.pages[0].items[0].title).toBe("newest"),
  );
  expect(mock.rpc.mock.calls.map((call) => call[1].p_search)).toEqual([
    "old",
    "newest",
  ]);
  await act(async () => resolveOld({ data: page("old"), error: null }));
  expect(result.current.data?.pages[0].items[0].title).toBe("newest");
});
it("requests the next page only on demand and retains previous page results", async () => {
  mock.rpc.mockImplementation((_name, args) => ({
    abortSignal: () =>
      Promise.resolve({
        data: page(`page${args.p_page}`, args.p_page),
        error: null,
      }),
  }));
  const { result } = renderHook(
    () => useResourceSearch(request, demoSnapshot, false),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(mock.rpc.mock.calls.map((call) => call[1].p_page)).toEqual([1, 2]);
  expect(result.current.hasNextPage).toBe(false);
});
