import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { demoSnapshot } from "../data/demo";

vi.mock("../lib/supabase", () => ({
  isDemoMode: true,
  isSupabaseConfigured: false,
  supabase: null,
}));

afterEach(() => vi.unstubAllEnvs());

it("keeps demo notifications available when V2 is enabled without a database", async () => {
  vi.stubEnv("VITE_QUERY_LAYER_V2", "true");
  const { ActivityCenter } = await import("./ActivityCenter");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActivityCenter data={structuredClone(demoSnapshot)} audience="coach" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: /unread notifications/ }),
  ).toBeInTheDocument();
});
