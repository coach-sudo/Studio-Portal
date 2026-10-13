import { beforeEach, describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import type { Student, LinkedContact } from "../../../src/domain/model";
import { handleInvoiceCommands } from "./invoices";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  dispatch: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../_shared/outbox-dispatch", () => ({
  dispatchOutbox: mocks.dispatch,
}));
vi.mock("../_shared/supabase", () => ({
  serviceClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ upsert: mocks.upsert, update: mocks.update }),
  }),
}));
vi.mock("../_shared/notification-recipients", () => ({
  notificationRecipientContext: mocks.context,
  resolveEventRecipients: vi.fn(),
}));
vi.mock("../_shared/portal-url", () => ({
  portalOrigin: () => "https://studio.test",
}));
const studentId = "10000000-0000-4000-8000-000000000001";
const serviceId = "10000000-0000-4000-8000-000000000002";
const studioId = "10000000-0000-4000-8000-000000000003";
let billingContext: { student: Student; contacts: LinkedContact[] };
const legacyInvoice = {
  id: "invoice-id",
  studio_id: studioId,
  student_id: studentId,
  number: "INV-OLD",
  status: "open",
  version: 3,
  currency: "USD",
  due_date: "2026-10-27",
  recipient: { name: "Student", email: "student@example.test" },
  branding: { studioName: "Studio" },
  total_minor: 10000,
  paid_minor: 0,
  credit_minor: 0,
  items: [],
  introduction: "Invoice details",
  footer: "Thank you",
};
function fixture(status = "open") {
  const values: Record<string, unknown> = {
    students: {
      id: studentId,
      full_name: "Student",
      email: "student@example.test",
    },
    studios: { name: "Test Studio", settings: { currency: "USD" } },
    booking_services: { id: serviceId, currency: "USD" },
    studio_invoices: legacyInvoice,
  };
  return {
    domain: "invoices",
    context: { waitUntil: vi.fn() },
    id: "correlation",
    input: {
      command: "save",
      expectedVersion: 0,
      idempotencyKey: "save-key",
      payload: {
        student_id: studentId,
        status,
        issue_date: "2026-10-13",
        due_date: "2026-10-27",
        introduction: "Details",
        notes: "",
        footer: "Thanks",
        items: [
          {
            id: serviceId,
            referenceId: serviceId,
            kind: "service",
            description: "Coaching",
            quantity: 1,
            unitMinor: 10000,
            startsOn: "2026-10-13",
            endsOn: "2026-10-13",
            lessonIds: [],
          },
        ],
      },
    },
    requireCoach: vi.fn().mockResolvedValue(studioId),
    audit: vi.fn().mockResolvedValue("audit"),
    db: {
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({ data: values[table], error: null }),
        };
        return query;
      },
    },
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  billingContext = {
    student: {
      id: studentId,
      fullName: "Student",
      email: "student@example.test",
      isMinor: true,
    } as Student,
    contacts: [
      {
        id: "payer",
        studentId,
        fullName: "Paying Parent",
        email: "payer@example.test",
        isPrimaryPayer: true,
        portalEnabled: true,
        canViewFinance: true,
        canReceiveNotifications: true,
      } as LinkedContact,
    ],
  };
  mocks.context.mockImplementation(async () => billingContext);
  mocks.upsert.mockReturnValue({
    select: async () => ({ data: [{ id: "invoice-email" }], error: null }),
  });
  mocks.dispatch.mockResolvedValue({ sent: 1 });
  mocks.update.mockImplementation((patch: Record<string, unknown>) => {
    const query = {
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({
        data: { ...legacyInvoice, ...patch },
        error: null,
      }),
    };
    return query;
  });
  mocks.rpc.mockImplementation(
    async (
      _name: string,
      { p_value }: { p_value: Record<string, unknown> },
    ) => ({
      data: {
        ...p_value,
        id: "invoice-id",
        number: "INV-1",
        total_minor: 10000,
        paid_minor: 0,
        credit_minor: 0,
        version: 1,
      },
      error: null,
    }),
  );
});
describe("invoices bill and email the responsible payer", () => {
  it("corrects an older invoice's addressee to the current payer when the coach sends it", async () => {
    const ctx = fixture();
    ctx.input.command = "send";
    ctx.input.entityId = legacyInvoice.id;
    ctx.input.expectedVersion = legacyInvoice.version;
    ctx.input.payload = { recipients: ["payer@example.test"] };
    const response = await handleInvoiceCommands(ctx);
    expect(response!.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: {
          name: "Paying Parent",
          email: "payer@example.test",
          studentName: "Student",
        },
        version: 4,
      }),
    );
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      recipient: "payer@example.test",
      body: expect.stringContaining("Hello Paying Parent,"),
      entity_snapshot: expect.objectContaining({ invoiceVersion: 4 }),
    });
  });
  it("labels the invoice for the primary payer and queues their email automatically", async () => {
    const response = await handleInvoiceCommands(fixture());
    const body = await response!.json();
    expect(body.resource.recipient).toEqual({
      name: "Paying Parent",
      email: "payer@example.test",
      studentName: "Student",
    });
    expect(body.delivery).toEqual({
      status: "queued",
      recipients: ["payer@example.test"],
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "payer@example.test",
        student_id: studentId,
        status: "queued",
        recipient_intent: "payment_due",
        body: expect.stringContaining("Hello Paying Parent,"),
        entity_snapshot: expect.objectContaining({
          invoiceId: "invoice-id",
          invoiceVersion: 1,
          approvedAt: expect.any(String),
        }),
      }),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    expect(mocks.upsert.mock.calls[0][0].recipient).not.toBe(
      "student@example.test",
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({ ids: ["invoice-email"] });
  });
  it("saves payer-addressed drafts without queuing mail", async () => {
    const body = await (await handleInvoiceCommands(fixture("draft")))!.json();
    expect(body.resource.recipient.name).toBe("Paying Parent");
    expect(body.delivery.status).toBe("draft");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each(["missing", "disabled", "opted-out", "ambiguous", "not-designated"])(
    "blocks issuing when payer configuration is %s",
    async (condition) => {
      if (condition === "missing") billingContext.contacts = [];
      if (condition === "disabled")
        billingContext.contacts[0].canViewFinance = false;
      if (condition === "not-designated")
        billingContext.contacts[0].isPrimaryPayer = false;
      if (condition === "opted-out")
        billingContext.contacts[0].notificationPreferences = {
          ...billingContext.contacts[0].notificationPreferences,
          payments: false,
        };
      if (condition === "ambiguous")
        billingContext.contacts.push({
          ...billingContext.contacts[0],
          id: "another-payer",
        });
      await expect(handleInvoiceCommands(fixture())).rejects.toThrow(
        "VALIDATION_FAILED",
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );
  it("uses the adult student's email when they pay for themselves", async () => {
    billingContext.student.isMinor = false;
    billingContext.contacts = [];
    const body = await (await handleInvoiceCommands(fixture()))!.json();
    expect(body.resource.recipient).toEqual({
      name: "Student",
      email: "student@example.test",
    });
    expect(mocks.upsert.mock.calls[0][0].recipient).toBe(
      "student@example.test",
    );
  });
  it("uses the same email deduplication key when the save is retried", async () => {
    await handleInvoiceCommands(fixture());
    await handleInvoiceCommands(fixture());
    expect(mocks.upsert.mock.calls[0][0].dedupe_key).toBe(
      mocks.upsert.mock.calls[1][0].dedupe_key,
    );
  });
  it("reports a saved invoice separately from a queue failure", async () => {
    mocks.upsert.mockReturnValue({
      select: async () => ({ error: new Error("Delivery queue unavailable") }),
    });
    const response = await handleInvoiceCommands(fixture());
    const body = await response!.json();
    expect(response!.status).toBe(200);
    expect(body.resource.id).toBe("invoice-id");
    expect(body.delivery.status).toBe("failed");
    expect(body.delivery.message).toContain("Invoice saved");
  });
  it("does not issue an invoice for a non-coach", async () => {
    const ctx = fixture();
    ctx.requireCoach = vi.fn().mockRejectedValue(new Error("FORBIDDEN"));
    await expect(handleInvoiceCommands(ctx)).rejects.toThrow("FORBIDDEN");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
