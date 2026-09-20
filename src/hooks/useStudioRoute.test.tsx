import { Fragment, type ComponentType, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "../data/demo";

const loadStudioSnapshot = vi.hoisted(() => vi.fn());

vi.mock("../data/repository", () => ({
  studioDomains: [
    "identity",
    "students",
    "lessons",
    "booking",
    "work",
    "finance",
    "messaging",
    "actorProfiles",
    "households",
    "referrals",
    "administration",
  ],
  loadStudioSnapshot,
}));

vi.mock("../lib/supabase", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
}));

const wrapperFor = (
  queryClient: QueryClient,
  StoreProvider: ComponentType<{ children: ReactNode }> = Fragment,
) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <StoreProvider>{children}</StoreProvider>
      </QueryClientProvider>
    );
  };

describe("V2 domain query behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_QUERY_LAYER_V2", "true");
    loadStudioSnapshot.mockReset();
    loadStudioSnapshot.mockResolvedValue(structuredClone(demoSnapshot));
  });

  it("measures no more than eight initial requests on representative routes", async () => {
    const [{ useStudioRoute }, { StudioStoreProvider }] = await Promise.all([
      import("./useStudio"),
      import("../state/StudioStore"),
    ]);
    const coachDomains = [
      "identity",
      "students",
      "lessons",
      "work",
      "finance",
      "actorProfiles",
      "administration",
      "booking",
    ] as const;
    const coachClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const coach = renderHook(
      () => useStudioRoute("coach", undefined, coachDomains),
      { wrapper: wrapperFor(coachClient, StudioStoreProvider) },
    );
    await waitFor(() => expect(coach.result.current.data).toBeDefined());
    expect(loadStudioSnapshot).toHaveBeenCalledTimes(8);
    expect(
      new Set(loadStudioSnapshot.mock.calls.map((call) => call[2][0])),
    ).toEqual(new Set(coachDomains));

    loadStudioSnapshot.mockClear();
    const portalClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const portal = renderHook(
      () =>
        useStudioRoute("student", "student-maya", [
          "identity",
          "students",
          "lessons",
          "booking",
          "work",
        ]),
      { wrapper: wrapperFor(portalClient, StudioStoreProvider) },
    );
    await waitFor(() => expect(portal.result.current.data).toBeDefined());
    expect(loadStudioSnapshot).toHaveBeenCalledTimes(5);

    coach.unmount();
    portal.unmount();
  });

  it("refetches only the domain and page affected by a mutation", async () => {
    const {
      countActiveDomainRefetches,
      invalidateStudioDomains,
      studioDomainQueryKey,
    } = await import("./useStudio");
    const counts = { identity: 0, students: 0, page: 0 };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const target = renderHook(
      () => {
        useQuery({
          queryKey: studioDomainQueryKey("coach", undefined, "identity"),
          queryFn: async () => ++counts.identity,
        });
        useQuery({
          queryKey: studioDomainQueryKey("coach", undefined, "students"),
          queryFn: async () => ++counts.students,
        });
        useQuery({
          queryKey: ["studio-page", "students", "students", 1, 25],
          queryFn: async () => ++counts.page,
        });
      },
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() =>
      expect(counts).toEqual({ identity: 1, students: 1, page: 1 }),
    );
    expect(countActiveDomainRefetches(queryClient, ["students"])).toBe(2);

    await act(async () => {
      await invalidateStudioDomains(queryClient, ["students"]);
    });
    await waitFor(() =>
      expect(counts).toEqual({ identity: 1, students: 2, page: 2 }),
    );
    target.unmount();
  });
});
