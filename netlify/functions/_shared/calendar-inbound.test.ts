import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncInboundCalendar } from "./calendar-inbound";

afterEach(() => vi.unstubAllGlobals());

it("resumes the saved incremental page and leaves it intact on provider failure", async () => {
  vi.stubGlobal("Netlify", {
    env: { get: () => "true" },
  });
  const rpc = vi.fn().mockResolvedValue({
    data: { revision: 4, syncToken: "cursor", pageToken: "next" },
  });
  const db = { rpc } as Pick<SupabaseClient, "rpc">;
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);

  await expect(
    syncInboundCalendar(db, "studio", "calendar", "access"),
  ).rejects.toThrow("503");
  expect(rpc).toHaveBeenCalledTimes(1);
  const request = new URL(fetch.mock.calls[0][0]);
  expect(request.searchParams.get("syncToken")).toBe("cursor");
  expect(request.searchParams.get("pageToken")).toBe("next");
  expect(request.searchParams.get("singleEvents")).toBe("false");
});

it("resets an expired cursor before fetching a new full scan", async () => {
  vi.stubGlobal("Netlify", { env: { get: () => "true" } });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: { revision: 4, syncToken: "old", pageToken: null },
    })
    .mockResolvedValueOnce({
      data: { committed: true, imported: 0, review: 0 },
    })
    .mockResolvedValueOnce({
      data: { revision: 5, syncToken: null, pageToken: null },
    })
    .mockResolvedValueOnce({
      data: { committed: true, imported: 0, review: 0 },
    });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 410 }))
    .mockResolvedValueOnce(Response.json({ nextSyncToken: "new" }));
  vi.stubGlobal("fetch", fetch);

  await syncInboundCalendar(
    { rpc } as Pick<SupabaseClient, "rpc">,
    "studio",
    "calendar",
    "access",
  );
  expect(new URL(fetch.mock.calls[1][0]).searchParams.has("syncToken")).toBe(
    false,
  );
  expect(rpc).toHaveBeenNthCalledWith(
    2,
    "commit_calendar_inbound_page",
    expect.objectContaining({ p_revision: 4, p_reset: true }),
  );
  expect(rpc).toHaveBeenNthCalledWith(
    4,
    "commit_calendar_inbound_page",
    expect.objectContaining({
      p_revision: 5,
      p_next_sync: "new",
      p_reset: false,
    }),
  );
});
