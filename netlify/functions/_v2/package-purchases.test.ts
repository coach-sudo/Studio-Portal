// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFinanceCommands } from "./finance";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("../_shared/supabase", () => ({ serviceClient: mocks.service }));
vi.mock("stripe", () => ({
  default: class {
    prices = { retrieve: mocks.retrieve, create: mocks.create };
    checkout = { sessions: { create: mocks.checkout } };
  },
}));

function fixture(enabled = true, pricingError = false) {
  const writes: Array<{
    table: string;
    action: string;
    values: Record<string, unknown>;
  }> = [];
  const filters: Array<[string, string, unknown]> = [];
  const rows: Record<string, Record<string, unknown>> = {
    students: {
      id: "student",
      studio_id: "studio",
      special_pricing_enabled: enabled,
    },
    package_definitions: {
      id: "definition",
      studio_id: "studio",
      name: "Four lessons",
      price_minor: 36000,
      currency: "USD",
      session_count: 4,
      pricing_service_id: "service",
      discount_type: "percent",
      discount_basis_points: 1000,
      stripe_price_id: "price-original",
    },
    booking_services: {
      id: "service",
      name: "Coaching",
      duration_minutes: 60,
      price_minor: 12000,
      currency: "USD",
      version: 2,
    },
    studios: { settings: { bookingDefaults: { inPersonUpchargeMinor: 2500 } } },
    student_pricing_rules: { price_minor: 8000 },
    package_billing_options: {
      id: "option",
      stripe_price_id: "price-original",
    },
    student_credit_accounts: { auto_apply: false },
  };
  const db = {
    from(table: string) {
      let inserted: Record<string, unknown> | undefined;
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([table, column, value]);
          return query;
        },
        lte(column: string, value: unknown) {
          filters.push([table, column, value]);
          return query;
        },
        or(value: string) {
          filters.push([table, "or", value]);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        insert(values: Record<string, unknown>) {
          inserted = values;
          writes.push({ table, action: "insert", values });
          return query;
        },
        delete() {
          writes.push({ table, action: "delete", values: {} });
          return query;
        },
        async single() {
          return {
            data: inserted ? { id: "purchase", ...inserted } : rows[table],
            error: null,
          };
        },
        async maybeSingle() {
          return {
            data: rows[table],
            error:
              pricingError && table === "student_pricing_rules"
                ? new Error("Pricing unavailable")
                : null,
          };
        },
      };
      return query;
    },
  };
  mocks.service.mockReturnValue(db);
  const audit = vi.fn().mockResolvedValue("audit");
  const requireCoach = vi.fn().mockResolvedValue("studio");
  const command = (
    domain = "finance",
    name = "checkout_definition",
    amount = enabled ? 28800 : 43200,
  ) =>
    handleFinanceCommands({
      db,
      domain,
      input: {
        command: name,
        idempotencyKey: "purchase-key",
        expectedVersion: 0,
        payload: {
          packageDefinitionId: "definition",
          definitionId: "definition",
          studentId: "student",
          renewalMode: "one_time",
          expectedPriceMinor: amount,
          expectedCurrency: "USD",
        },
      },
      audit,
      requireCoach,
    } as never);
  return { writes, filters, command, requireCoach };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "STRIPE_SECRET_KEY"
          ? "test-only-key"
          : key === "DEPLOY_PRIME_URL"
            ? "https://portal.example.test"
            : undefined,
    },
  });
  mocks.retrieve.mockResolvedValue({
    id: "price-original",
    product: "product",
    unit_amount: 36000,
    currency: "usd",
    metadata: {},
  });
  mocks.create.mockResolvedValue({ id: "price-quoted" });
  mocks.checkout.mockResolvedValue({
    id: "checkout",
    url: "https://checkout.example.test",
  });
});

describe("new package purchases and assignments", () => {
  it.each([true, false])(
    "snapshots and charges the current quote with special pricing enabled=%s",
    async (enabled) => {
      const { command, writes, filters } = fixture(enabled);
      const amount = enabled ? 28800 : 43200;
      const response = await command();
      expect(response?.status).toBe(200);
      expect(writes).toEqual([
        {
          table: "packages",
          action: "insert",
          values: expect.objectContaining({
            student_id: "student",
            price_minor: amount,
            currency: "USD",
            stripe_price_id: "price-quoted",
            credit_quantity: 4,
          }),
        },
      ]);
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ unit_amount: amount }),
        { idempotencyKey: "purchase-key:price" },
      );
      expect(mocks.checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: "price-quoted", quantity: 1 }],
        }),
        { idempotencyKey: "purchase-key" },
      );
      expect(filters).toContainEqual([
        "booking_services",
        "studio_id",
        "studio",
      ]);
      if (enabled) {
        expect(filters).toContainEqual([
          "student_pricing_rules",
          "studio_id",
          "studio",
        ]);
        expect(
          filters.some(
            ([table, column]) =>
              table === "student_pricing_rules" && column === "starts_at",
          ),
        ).toBe(true);
        expect(
          filters.some(
            ([table, column, value]) =>
              table === "student_pricing_rules" &&
              column === "or" &&
              String(value).startsWith("ends_at.is.null,ends_at.gte."),
          ),
        ).toBe(true);
      } else
        expect(
          filters.some(([table]) => table === "student_pricing_rules"),
        ).toBe(false);
    },
  );
  it("uses the same effective quote when a coach assigns a new package", async () => {
    const { command, writes, requireCoach } = fixture();
    await command("packages", "assign");
    expect(requireCoach).toHaveBeenCalledOnce();
    expect(writes.find((w) => w.table === "packages")?.values.price_minor).toBe(
      28800,
    );
    expect(
      writes.some(
        (w) =>
          w.table === "package_definitions" ||
          w.table === "package_billing_options",
      ),
    ).toBe(false);
  });
  it("rejects a changed displayed price before creating a price, package, or checkout", async () => {
    const { command, writes } = fixture();
    await expect(
      command("finance", "checkout_definition", 36000),
    ).rejects.toThrow("Refresh and review");
    expect(writes).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("fails closed when student pricing cannot be read", async () => {
    const { command, writes } = fixture(true, true);
    await expect(command()).rejects.toThrow("Pricing unavailable");
    expect(writes).toEqual([]);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});
