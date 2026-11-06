import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import type { Student, LinkedContact } from "../../../src/domain/model";
import { handleInvoiceCommands } from "./invoices";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  dispatch: vi.fn(),
  update: vi.fn(),
  origin: vi.fn(() => "https://studio.test"),
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    checkout = {
      sessions: {
        create: mocks.create,
        retrieve: mocks.retrieve,
        expire: mocks.expire,
      },
    };
  },
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
  portalOrigin: mocks.origin,
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

describe("invoice Checkout return and recovery", () => {
  const preview =
    "https://6aebaf2c3614f41db77b4b43--coachd-staging.netlify.app";
  const session = {
    id: "cs_test_fixture",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/test",
  };
  const claim = {
    ...legacyInvoice,
    checkout_key: "coach:checkout-key",
    checkout_amount: 100,
    checkout_session_id: null as string | null,
  };

  function checkout(command = "checkout", invoice: typeof claim = claim) {
    const ctx = fixture();
    ctx.input = {
      command,
      entityId: invoice.id,
      expectedVersion: invoice.version,
      reason: "Test checkout recovery",
      idempotencyKey: "checkout-key",
      payload: { returnTo: "coach", amountMinor: 100 },
    };
    ctx.db.from = vi.fn(() => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: invoice }),
      };
      return query;
    }) as unknown as typeof ctx.db.from;
    return ctx;
  }

  beforeEach(() => {
    vi.stubGlobal("Netlify", { env: { get: () => "rk_test_fixture" } });
    mocks.origin.mockReturnValue(preview);
    mocks.create.mockReset().mockResolvedValue(session);
    mocks.retrieve.mockReset().mockResolvedValue(session);
    mocks.expire
      .mockReset()
      .mockResolvedValue({ ...session, status: "expired" });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "claim_studio_invoice_checkout"
        ? { data: claim }
        : { data: null },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.origin.mockReset().mockReturnValue("https://studio.test");
  });

  it("uses trusted function context for both return links before claiming the invoice", async () => {
    const ctx = checkout();
    ctx.request = new Request("https://untrusted.test", {
      headers: { origin: "https://untrusted.test" },
    });
    await handleInvoiceCommands(ctx);
    expect(mocks.origin).toHaveBeenCalledWith(ctx.context);
    expect(mocks.origin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0],
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: `${preview}/coach/finance?invoice=invoice-id&checkout=processing`,
        cancel_url: `${preview}/coach/finance?invoice=invoice-id`,
      }),
      { idempotencyKey: claim.checkout_key },
    );
  });

  it("fails before any claim or provider call if the private origin cannot be verified", async () => {
    mocks.origin.mockImplementationOnce(() => {
      throw Error("Private checkout preview identity is unavailable");
    });
    await expect(handleInvoiceCommands(checkout())).rejects.toThrow(
      "Private checkout preview identity",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps the claim on an interrupted provider request and retries with identical Stripe parameters", async () => {
    mocks.create.mockRejectedValueOnce(
      Error("Connection closed before the response"),
    );
    await expect(handleInvoiceCommands(checkout())).rejects.toThrow(
      "Connection closed",
    );
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_studio_invoice_checkout",
    ]);
    const response = await handleInvoiceCommands(checkout());
    expect(await response!.json()).toEqual({
      resource: { url: session.url, status: "pending" },
    });
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_studio_invoice_checkout",
      "claim_studio_invoice_checkout",
      "attach_studio_invoice_checkout",
    ]);
  });

  it("recovers the same Checkout Session if Stripe accepted it but attaching it failed", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: claim })
      .mockResolvedValueOnce({ error: Error("Attach response lost") });
    await expect(handleInvoiceCommands(checkout())).rejects.toThrow(
      "Attach response lost",
    );
    await handleInvoiceCommands(checkout());
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
    expect(
      mocks.rpc.mock.calls
        .filter(([name]) => name === "attach_studio_invoice_checkout")
        .map(([, args]) => args.p_session),
    ).toEqual([session.id, session.id]);
    expect(
      mocks.rpc.mock.calls.some(
        ([name]) => name.includes("settle") || name.includes("release"),
      ),
    ).toBe(false);
  });

  it("expires an open checkout before releasing the claim and never settles it", async () => {
    const response = await handleInvoiceCommands(
      checkout("cancel_checkout", {
        ...claim,
        checkout_session_id: session.id,
      }),
    );
    expect(await response!.json()).toEqual({ resource: { status: "expired" } });
    expect(mocks.retrieve).toHaveBeenCalledWith(session.id);
    expect(mocks.expire).toHaveBeenCalledWith(session.id);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "attach_studio_invoice_checkout",
      "release_studio_invoice_checkout",
    ]);
    expect(mocks.expire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1],
    );
  });

  it("does not release or settle an open checkout when cancellation loses the provider response", async () => {
    mocks.expire.mockRejectedValueOnce(Error("Expire response lost"));
    await expect(
      handleInvoiceCommands(
        checkout("cancel_checkout", {
          ...claim,
          checkout_session_id: session.id,
        }),
      ),
    ).rejects.toThrow("Expire response lost");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "attach_studio_invoice_checkout",
    ]);
    mocks.retrieve.mockResolvedValueOnce({ ...session, status: "expired" });
    const response = await handleInvoiceCommands(
      checkout("check_checkout", { ...claim, checkout_session_id: session.id }),
    );
    expect(await response!.json()).toEqual({ resource: { status: "expired" } });
    expect(mocks.expire).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "attach_studio_invoice_checkout",
      "attach_studio_invoice_checkout",
      "release_studio_invoice_checkout",
    ]);
  });

  it("keeps an interrupted or declined payment unpaid while Stripe reports the checkout open", async () => {
    const response = await handleInvoiceCommands(
      checkout("check_checkout", { ...claim, checkout_session_id: session.id }),
    );
    expect(await response!.json()).toEqual({
      resource: { url: session.url, status: "pending" },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "attach_studio_invoice_checkout",
    ]);
  });

  it("settles through the same canonical RPC if the provider reports payment won the cancellation race", async () => {
    mocks.retrieve.mockResolvedValueOnce({
      ...session,
      status: "complete",
      payment_status: "paid",
      currency: "usd",
      amount_total: 100,
    });
    await handleInvoiceCommands(
      checkout("cancel_checkout", {
        ...claim,
        checkout_session_id: session.id,
      }),
    );
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "attach_studio_invoice_checkout",
      "settle_studio_invoice_checkout",
    ]);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "settle_studio_invoice_checkout",
      {
        p_invoice: claim.id,
        p_key: claim.checkout_key,
        p_session: session.id,
        p_amount: 100,
      },
    );
  });

  it("denies an invoice the caller cannot see before making a Stripe call or reserving money", async () => {
    const ctx = checkout();
    ctx.db.from = vi.fn(() => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: null, error: Error("Not visible") }),
      };
      return query;
    }) as unknown as typeof ctx.db.from;
    await expect(handleInvoiceCommands(ctx)).rejects.toThrow("FORBIDDEN");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
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
