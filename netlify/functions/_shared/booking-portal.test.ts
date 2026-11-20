import { beforeEach, expect, it, vi } from "vitest";
import bookingPortal from "../booking-portal";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  from: vi.fn(),
  payer: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("./supabase", () => ({
  userClient: () => ({ auth: { getUser: mocks.user }, from: mocks.from }),
}));
vi.mock("./training-checkout", () => ({
  trainingCheckout: mocks.payer,
}));
vi.mock("stripe", () => ({ default: mocks.provider }));

const student = "f7507f4f-5874-473b-9976-4b676d7c4730";
const actor = "edbeac19-e21b-495b-b7ee-32cbd3541b18";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.payer.mockResolvedValue({ studentIds: [] });
});

it.each(["billing", "payment-method"])(
  "checks current payer authority before exposing Stripe %s",
  async (action) => {
    const result = await bookingPortal(
      new Request(
        "https://portal.example.test/api/v2/portal/bookings/" + action,
        {
          method: "POST",
          body: JSON.stringify({ studentId: student }),
        },
      ),
      { requestId: "billing-authority", params: { action } } as never,
    );
    expect(result.status).toBe(403);
    expect(mocks.payer).toHaveBeenCalledWith("payers", {
      actor,
      studentIds: [student],
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  },
);
