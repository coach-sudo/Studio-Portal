import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  isDemoMode: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
    },
  },
}));
vi.mock("../data/queryIdentity", () => ({
  ensureQueryIdentityIsolation: () => undefined,
}));
import { AuthGate } from "./AuthRoutes";
function LoginReturn() {
  return <p>{new URLSearchParams(useLocation().search).get("returnTo")}</p>;
}
it("keeps the invoice ID through the login redirect from an email or PDF Pay button", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/portal/payments?invoice=invoice-id"]}>
        <Routes>
          <Route
            path="/portal/payments"
            element={
              <AuthGate role="portal">
                <p>Invoice</p>
              </AuthGate>
            }
          />
          <Route path="/login" element={<LoginReturn />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("/portal/payments?invoice=invoice-id"),
  ).toBeInTheDocument();
});
