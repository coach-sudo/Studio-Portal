import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  user: vi.fn(),
  visible: vi.fn(),
  messages: vi.fn(),
  ids: vi.fn(),
  service: vi.fn(),
}));
vi.mock("./supabase", () => ({
  userClient: () => ({
    auth: { getUser: mocked.user },
    from: () => {
      const q = { select: () => q, order: () => q, range: mocked.visible };
      return q;
    },
  }),
  serviceClient: () => {
    mocked.service();
    const q = {
      select: () => q,
      eq: () => q,
      in: (field: string, ids: string[]) => {
        mocked.ids(field, ids);
        return q;
      },
      order: () => q,
      range: mocked.messages,
    };
    return { from: () => q };
  },
}));
import handler from "../invoices";
beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.mockResolvedValue({ data: { user: { id: "payer" } } });
  mocked.visible.mockResolvedValue({
    data: [{ id: "visible-invoice", student_id: "student" }],
    error: null,
  });
  mocked.messages.mockResolvedValue({
    data: [
      {
        status: "sent",
        updated_at: "2026-10-13",
        entity_snapshot: { invoiceId: "visible-invoice" },
      },
      {
        status: "failed",
        last_error: "Private",
        entity_snapshot: { invoiceId: "another-invoice" },
      },
    ],
    error: null,
  });
});
it("shows delivery status only for the caller's visible invoices", async () => {
  const response = await handler(
    new Request("https://studio.test/api/invoices"),
  );
  const body = await response.json();
  expect(mocked.ids).toHaveBeenCalledWith("entity_snapshot->>invoiceId", [
    "visible-invoice",
  ]);
  expect(body.invoices).toHaveLength(1);
  expect(body.invoices[0].delivery).toMatchObject({ status: "sent" });
  expect(JSON.stringify(body)).not.toContain("Private");
});
it("keeps invoices visible if delivery status is temporarily unavailable", async () => {
  mocked.messages.mockResolvedValue({
    data: null,
    error: new Error("Temporarily unavailable"),
  });
  const body = await (
    await handler(new Request("https://studio.test/api/invoices"))
  ).json();
  expect(body.invoices[0].delivery.status).toBe("unknown");
});
it("does not read outbox messages for an unauthenticated caller", async () => {
  mocked.user.mockResolvedValue({ data: { user: null } });
  const response = await handler(
    new Request("https://studio.test/api/invoices"),
  );
  expect(response.status).toBe(401);
  expect(mocked.service).not.toHaveBeenCalled();
});
