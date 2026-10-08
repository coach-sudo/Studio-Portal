import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  isolateQueryIdentity,
  ensureQueryIdentityIsolation,
} from "./queryIdentity";
it("retains query results on token refresh but clears private data on sign-out or account change", () => {
  const client = new QueryClient();
  let listener: (
    _event: string,
    session: { user: { id: string } } | null,
  ) => void = () => {};
  isolateQueryIdentity(client, {
    onAuthStateChange: vi.fn((callback) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  } as never);
  listener("SIGNED_IN", { user: { id: "coach" } });
  client.setQueryData(["material-assignment", "private"], {
    coachNotes: "private",
  });
  listener("TOKEN_REFRESHED", { user: { id: "coach" } });
  expect(client.getQueryData(["material-assignment", "private"])).toBeDefined();
  listener("SIGNED_OUT", null);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  listener("SIGNED_IN", { user: { id: "coach" } });
  client.setQueryData(["private"], "coach information");
  listener("SIGNED_IN", { user: { id: "student" } });
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
it("registers once for a query client across workspace navigation", () => {
  const client = new QueryClient(),
    auth = { onAuthStateChange: vi.fn() };
  ensureQueryIdentityIsolation(client, auth as never);
  ensureQueryIdentityIsolation(client, auth as never);
  expect(auth.onAuthStateChange).toHaveBeenCalledOnce();
});
